// Headless-Chrome CDP driver for the pond lab and the site: load a URL, optionally run PRE once the page
// object exists, wait until READY is truthy, run POST (awaited; its JSON result is printed), then save a
// screenshot (+ the fish atlas as PNG when the lab is present). Logs console output, exceptions and every
// response with status >= 400. Exit code 1 when READY never became truthy.
//
//   node scripts/pond/shot.mjs <url> <outPrefix> [--wait ms] [--w px] [--h px] [--post-wait ms] [--gpu]
//   env: READY, PRE, POST (JS expressions), or the same as --ready/--pre/--post flags
//
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const opts = { wait: 240000, w: 1440, h: 900, postWait: 800, gpu: false, ready: process.env.READY, pre: process.env.PRE, post: process.env.POST };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--wait') opts.wait = +argv[++i];
  else if (a === '--w') opts.w = +argv[++i];
  else if (a === '--h') opts.h = +argv[++i];
  else if (a === '--post-wait') opts.postWait = +argv[++i];
  else if (a === '--gpu') opts.gpu = true;
  else if (a === '--ready') opts.ready = argv[++i];
  else if (a === '--pre') opts.pre = argv[++i];
  else if (a === '--post') opts.post = argv[++i];
  else positional.push(a);
}
const [url, outPrefix] = positional;
if (!url || !outPrefix) { console.error('usage: shot.mjs <url> <outPrefix> [--wait ms] [--w px] [--h px] [--post-wait ms] [--gpu]'); process.exit(2); }

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9333 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'pond-shot-'));
const gl = opts.gpu ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const chrome = spawn(CHROME, ['--headless=new', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  ...gl, '--ignore-gpu-blocklist', '--hide-scrollbars', '--allow-file-access-from-files', `--window-size=${opts.w},${opts.h}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanup = () => { try { chrome.kill(); } catch { /* gone */ } try { rmSync(profile, { recursive: true, force: true }); } catch { /* busy */ } };

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(200); }
}
if (!wsUrl) { cleanup(); throw new Error('chrome did not start'); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const logs = []; const bad = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) bad.push(m.params.response.status + ' ' + m.params.response.url);
  if (m.method === 'Network.loadingFailed') bad.push('FAILED ' + (m.params.errorText || '') + ' ' + (m.params.type || ''));
};
const send = (method, params = {}, sessionId) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Network.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: opts.w, height: opts.h, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url }, sessionId);
const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)).result?.result?.value;

const READY = opts.ready || "(window.BoidsLab && BoidsLab.school.atlas && !/painting/.test(document.querySelector('#status').textContent)) ? 1 : 0";
const t0 = Date.now();
if (opts.pre) { while (Date.now() - t0 < 20000 && !(await evalJs('!!(window.BoidsLab || window.__site)'))) await sleep(300); await evalJs(opts.pre); await sleep(600); }
let ready = 0;
while (Date.now() - t0 < opts.wait) { await sleep(500); ready = await evalJs(READY); if (ready) break; }
await sleep(1500);
if (opts.post) console.log('POST:', JSON.stringify(await evalJs(opts.post)));
await sleep(opts.postWait);
const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync(`${outPrefix}.png`, Buffer.from(shot.result.data, 'base64'));
const atlas = (await evalJs('window.BoidsLab && BoidsLab.school.atlas ? BoidsLab.school.atlas.canvas.toDataURL("image/png") : ""')) || '';
if (atlas) writeFileSync(`${outPrefix}-atlas.png`, Buffer.from(atlas.split(',')[1], 'base64'));
console.log(`ready=${ready} after ${Date.now() - t0}ms; status: ${await evalJs("(document.querySelector('#status') || {}).textContent || ''")}`);
if (bad.length) console.log('HTTP>=400/failed:\n' + bad.slice(0, 20).join('\n'));
const shown = logs.filter((l) => !/GL Driver|swiftshader/i.test(l)).slice(0, 20);
if (shown.length) console.log(shown.join('\n'));
ws.close(); cleanup();
process.exit(ready ? 0 : 1);
