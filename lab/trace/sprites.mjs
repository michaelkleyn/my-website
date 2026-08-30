// Paint the lab headlessly and export every painted sprite as PNG. usage: node sprites.mjs <url> <outDir> [waitMs]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const [,, url, outDir, waitMs = '900000'] = process.argv;
mkdirSync(outDir, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9700 + Math.floor(Math.random() * 200);
const chrome = spawn(CHROME, ['--headless=new', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${outDir}/profile`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let wsUrl; for (let i = 0; i < 50 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(200); } }
const ws = new WebSocket(wsUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)); };
const send = (method, params = {}, sessionId) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId);
await send('Page.navigate', { url }, sessionId);
const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)).result?.result?.value;
const t0 = Date.now(); let ready = 0;
while (Date.now() - t0 < +waitMs) { await sleep(1000); ready = await evalJs("(window.TraceLab && !TraceLab.painting && TraceLab.items.length > 0) ? 1 : 0"); if (ready) break; }
const names = await evalJs("TraceLab.items.map(function (it) { return it.name; })");
for (const name of names) {
  const png = await evalJs(`(function(){ var it = TraceLab.items.filter(function (i) { return i.name === '${name}'; })[0]; return it && it.sprite ? it.sprite.canvas.toDataURL('image/png').split(',')[1] : ''; })()`);
  if (png) writeFileSync(`${outDir}/${name}.png`, Buffer.from(png, 'base64'));
}
console.log(`ready=${ready} after ${Date.now() - t0}ms; ${names.length} items; logs:`);
console.log(logs.filter(l => !/GL Driver/.test(l)).slice(0, 12).join('\n'));
ws.close(); chrome.kill();
