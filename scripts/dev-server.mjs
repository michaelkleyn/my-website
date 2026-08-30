import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import {
  readFile,
  writeFile,
  mkdir,
  stat,
} from 'node:fs/promises';
import { join, dirname, extname, normalize, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCENE_DIR = join(ROOT, 'assets', 'scene');
const RAW_DIR = join(SCENE_DIR, '_raw');

const HOST = '127.0.0.1';
const PORT = 5173;
const MAX_BODY = 25 * 1024 * 1024; // ~25MB
const RESPONSIVE_WIDTHS = [480, 960, 1536];
const PAGE_RE = /^[a-z-]+$/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.ply': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// ---------- small helpers ----------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Probe PATH for an executable (cwebp / sips). Resolves to true/false.
function which(cmd) {
  return new Promise((resolve) => {
    const probe = spawn('command', ['-v', cmd], { shell: '/bin/sh' });
    let found = false;
    probe.stdout.on('data', (d) => {
      if (d.toString().trim()) found = true;
    });
    probe.on('error', () => resolve(false));
    probe.on('close', () => resolve(found));
  });
}

// Run a command, resolving with {code, stdout, stderr}.
function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// Confine a path under a base directory; returns null if it escapes.
function confine(base, target) {
  const resolved = normalize(join(base, target));
  if (resolved !== base && !resolved.startsWith(base + sep)) return null;
  return resolved;
}

let OPTIMIZER = 'none'; // 'cwebp' | 'sips' | 'none' — set at startup
// Output extension for the active optimizer. cwebp -> webp; sips -> jpg (this
// macOS sips build can read webp but not WRITE it, so we emit jpeg per the
// contract's "sips can emit webp/jpeg" allowance).
let OUT_EXT = 'webp';

// ---------- editor endpoints ----------

async function handlePing(res) {
  sendJson(res, 200, { ok: true });
}

async function handleGetScene(res, page) {
  if (!PAGE_RE.test(page)) return sendJson(res, 400, { ok: false, error: 'bad page' });
  const file = join(SCENE_DIR, `${page}.json`);
  try {
    const text = await readFile(file, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(text);
  } catch {
    sendJson(res, 200, { page, version: 1, nodes: [] });
  }
}

async function handlePostScene(req, res, page) {
  if (!PAGE_RE.test(page)) return sendJson(res, 400, { ok: false, error: 'bad page' });
  let raw;
  try {
    raw = await readBody(req);
  } catch {
    return sendJson(res, 413, { ok: false, error: 'body too large' });
  }
  let scene;
  try {
    scene = JSON.parse(raw.toString('utf8'));
  } catch {
    return sendJson(res, 400, { ok: false, error: 'invalid JSON' });
  }
  const out = JSON.stringify(scene, null, 2) + '\n';
  const file = join(SCENE_DIR, `${page}.json`);
  await mkdir(SCENE_DIR, { recursive: true });
  await writeFile(file, out);
  sendJson(res, 200, { ok: true, bytes: Buffer.byteLength(out) });
}

// Read natural pixel dimensions via sips.
async function readDimensions(filePath) {
  const { code, stdout } = await run('sips', [
    '-g',
    'pixelWidth',
    '-g',
    'pixelHeight',
    filePath,
  ]);
  if (code !== 0) return { natW: 0, natH: 0 };
  const wMatch = stdout.match(/pixelWidth:\s*(\d+)/);
  const hMatch = stdout.match(/pixelHeight:\s*(\d+)/);
  return {
    natW: wMatch ? parseInt(wMatch[1], 10) : 0,
    natH: hMatch ? parseInt(hMatch[1], 10) : 0,
  };
}

// Encode the source image to the optimizer's output format at the given pixel
// width. width=0 => full size. Returns true on success.
async function encode(srcPath, outPath, width) {
  if (OPTIMIZER === 'cwebp') {
    const args = ['-quiet', '-q', '82'];
    if (width > 0) args.push('-resize', String(width), '0');
    args.push(srcPath, '-o', outPath);
    const { code } = await run('cwebp', args);
    return code === 0;
  }
  if (OPTIMIZER === 'sips') {
    // This sips build cannot write webp, so we emit jpeg.
    const args = ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82'];
    if (width > 0) args.push('--resampleWidth', String(width));
    args.push(srcPath, '--out', outPath);
    const { code } = await run('sips', args);
    return code === 0;
  }
  return false;
}

async function handleUpload(req, res) {
  let raw;
  try {
    raw = await readBody(req);
  } catch {
    return sendJson(res, 413, { ok: false, error: 'body too large' });
  }
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    return sendJson(res, 400, { ok: false, error: 'invalid JSON' });
  }
  const { filename, dataUrl } = payload || {};
  if (typeof filename !== 'string' || typeof dataUrl !== 'string') {
    return sendJson(res, 400, { ok: false, error: 'filename and dataUrl required' });
  }

  // Parse data URL: data:image/png;base64,XXXX
  const m = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!m) return sendJson(res, 400, { ok: false, error: 'malformed dataUrl' });
  const isBase64 = !!m[2];
  const bytes = isBase64
    ? Buffer.from(m[3], 'base64')
    : Buffer.from(decodeURIComponent(m[3]), 'utf8');

  // Sanitize the filename -> a safe base under assets/scene/.
  const safeName = basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const base = safeName.replace(/\.[^.]+$/, '') || 'upload';
  const ext = (extname(safeName) || '.png').toLowerCase();

  const rawTarget = confine(RAW_DIR, basename(`${base}${ext}`));
  if (!rawTarget) return sendJson(res, 400, { ok: false, error: 'bad path' });

  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(SCENE_DIR, { recursive: true });
  await writeFile(rawTarget, bytes);

  // Natural dimensions from the raw original.
  let { natW, natH } = await readDimensions(rawTarget);

  // No optimizer: copy the raw image into assets/scene/ unchanged.
  if (OPTIMIZER === 'none') {
    const copyTarget = confine(SCENE_DIR, basename(`${base}${ext}`));
    if (!copyTarget) return sendJson(res, 400, { ok: false, error: 'bad path' });
    await writeFile(copyTarget, bytes);
    const src = `assets/scene/${basename(copyTarget)}`;
    return sendJson(res, 200, {
      ok: true,
      src,
      srcset: '',
      natW,
      natH,
      optimizer: 'none',
    });
  }

  // Full-size optimized image -> <base>.<ext>
  const fullName = `${base}.${OUT_EXT}`;
  const fullPath = confine(SCENE_DIR, fullName);
  if (!fullPath) return sendJson(res, 400, { ok: false, error: 'bad path' });
  const fullOk = await encode(rawTarget, fullPath, 0);

  // If sips could not read dimensions (natW=0), we cannot honor "never upscale"
  // or emit a full-size srcset entry — flag it so callers know the srcset may be
  // incomplete. Skip responsive encodes in that case (a single full-size webp is
  // the safe result rather than blindly upscaling to every responsive width).
  let warning;
  if (!natW) {
    warning = 'could not read image dimensions; srcset may be incomplete';
  }

  // Responsive widths, never upscaling beyond natural width. Skipped entirely
  // when natW is unknown (see above).
  const srcsetParts = [];
  if (natW) {
    for (const w of RESPONSIVE_WIDTHS) {
      if (w >= natW) continue; // never upscale
      const name = `${base}-${w}.${OUT_EXT}`;
      const outPath = confine(SCENE_DIR, name);
      if (!outPath) continue;
      const ok = await encode(rawTarget, outPath, w);
      if (ok) srcsetParts.push(`assets/scene/${name} ${w}w`);
    }
  }

  // Include the full-size in the srcset at its natural width.
  if (fullOk && natW) {
    srcsetParts.push(`assets/scene/${fullName} ${natW}w`);
  }

  // If we somehow could not encode WebP, fall back to the raw copy.
  if (!fullOk) {
    const copyTarget = confine(SCENE_DIR, basename(`${base}${ext}`));
    if (copyTarget) await writeFile(copyTarget, bytes);
    const src = `assets/scene/${basename(copyTarget || rawTarget)}`;
    return sendJson(res, 200, {
      ok: true,
      src,
      srcset: '',
      natW,
      natH,
      optimizer: OPTIMIZER,
      warning: 'webp encode failed; copied raw',
    });
  }

  sendJson(res, 200, {
    ok: true,
    src: `assets/scene/${fullName}`,
    srcset: srcsetParts.join(', '),
    natW,
    natH,
    optimizer: OPTIMIZER,
    // The active optimizer's output extension. cwebp -> 'webp'; the macOS sips
    // build here can only WRITE jpeg, so src is '<name>.jpg' under sips. Editor
    // upload UIs MUST read `src`/`ext` directly and never assume '.webp'.
    ext: OUT_EXT,
    ...(warning ? { warning } : {}),
  });
}

async function handleHook(req, res) {
  // Documented stub: injecting data-le-id into source HTML is not implemented yet.
  try {
    await readBody(req);
  } catch {
    /* ignore */
  }
  sendJson(res, 200, { ok: false, todo: true });
}

// ---------- static file server ----------

async function serveStatic(req, res, pathname) {
  // Decode and strip the query string already removed by caller.
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendText(res, 400, 'Bad Request');
  }

  if (decoded === '/' || decoded === '') decoded = '/index.html';

  // Resolve under ROOT, rejecting traversal.
  const target = confine(ROOT, '.' + decoded);
  if (!target) return sendText(res, 403, 'Forbidden');

  let info;
  try {
    info = await stat(target);
  } catch {
    return sendText(res, 404, 'Not Found');
  }

  let filePath = target;
  if (info.isDirectory()) {
    filePath = join(target, 'index.html');
    try {
      info = await stat(filePath);
    } catch {
      return sendText(res, 404, 'Not Found');
    }
  }

  let data;
  try {
    data = await readFile(filePath);
  } catch {
    return sendText(res, 404, 'Not Found');
  }

  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') return res.end();
  res.end(data);
}

// ---------- router ----------

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const { pathname } = url;
    const method = req.method;

    // Editor API namespace.
    if (pathname.startsWith('/__editor/')) {
      if (pathname === '/__editor/ping' && method === 'GET') {
        return await handlePing(res);
      }
      if (pathname === '/__editor/upload' && method === 'POST') {
        return await handleUpload(req, res);
      }
      if (pathname === '/__editor/hook' && method === 'POST') {
        return await handleHook(req, res);
      }
      const sceneMatch = pathname.match(/^\/__editor\/scene\/([^/]+)$/);
      if (sceneMatch) {
        const page = sceneMatch[1];
        if (method === 'GET') return await handleGetScene(res, page);
        if (method === 'POST') return await handlePostScene(req, res, page);
        return sendJson(res, 405, { ok: false, error: 'method not allowed' });
      }
      return sendJson(res, 404, { ok: false, error: 'unknown editor endpoint' });
    }

    // Static files (GET/HEAD only).
    if (method === 'GET' || method === 'HEAD') {
      return await serveStatic(req, res, pathname);
    }

    return sendText(res, 405, 'Method Not Allowed');
  } catch (err) {
    // Never crash the server on a single bad request.
    try {
      sendText(res, 500, 'Internal Server Error');
    } catch {
      /* response may already be sent */
    }
    console.error('request error:', err && err.message ? err.message : err);
  }
});

// ---------- startup ----------

async function detectOptimizer() {
  if (await which('cwebp')) return 'cwebp';
  if (await which('sips')) return 'sips';
  return 'none';
}

OPTIMIZER = await detectOptimizer();
// cwebp writes webp; this macOS sips build can only write jpeg.
OUT_EXT = OPTIMIZER === 'cwebp' ? 'webp' : 'jpg';

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  Layout compositor dev server');
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  → serving ${ROOT}`);
  const fmt = OPTIMIZER === 'none' ? 'none' : `${OPTIMIZER} (.${OUT_EXT})`;
  console.log(`  → image optimizer: ${fmt}`);
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Is the dev server already running?`);
    process.exit(1);
  }
  console.error('server error:', err.message);
});
