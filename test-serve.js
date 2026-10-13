// node test-serve.js: exercises the launcher (serve.js) as a real child process, with no browser involved
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

let fail = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fail = 1; };
const SERVE = path.join(__dirname, 'serve.js');
const PORT = 18321;

function get(port, urlPath, { method = 'GET', host } = {}) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers: host ? { Host: host } : {} }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('error', () => resolve({ status: 0, body: Buffer.alloc(0), headers: {} }));
    req.end();
  });
}

// start serve.js and wait until it prints its "running at" line
function start(args, env = {}) {
  const child = spawn(process.execPath, [SERVE, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = { text: '' };
  child.stdout.on('data', d => { out.text += d; });
  child.stderr.on('data', d => { out.text += d; });
  const ready = new Promise(resolve => {
    const t = setInterval(() => { if (/running at|already running/.test(out.text) || child.exitCode !== null) { clearInterval(t); resolve(); } }, 30);
  });
  const exited = new Promise(resolve => child.on('exit', code => resolve(code)));
  return { child, out, ready, exited };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-'));
  const song = path.join(tmp, 'my song.mod');
  const songBytes = Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 7) & 255));
  fs.writeFileSync(song, songBytes);
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'top secret');

  // help and argument errors
  const help = spawnSync(process.execPath, [SERVE, '--help'], { encoding: 'utf8' });
  ok(help.status === 0 && /Usage:/.test(help.stdout) && /--no-browser/.test(help.stdout), '--help prints usage and exits 0');
  const bad = spawnSync(process.execPath, [SERVE, '--bogus'], { encoding: 'utf8' });
  ok(bad.status === 1 && /unknown option/.test(bad.stderr), 'an unknown option is refused with exit code 1');
  const missing = spawnSync(process.execPath, [SERVE, path.join(tmp, 'nope.mod'), '--no-browser'], { encoding: 'utf8' });
  ok(missing.status === 1 && /cannot find/.test(missing.stderr), 'a file that does not exist is refused with a clear message');
  const dir = spawnSync(process.execPath, [SERVE, tmp, '--no-browser'], { encoding: 'utf8' });
  ok(dir.status === 1 && /not a file/.test(dir.stderr), 'a folder is refused as the file to open');
  const badPort = spawnSync(process.execPath, [SERVE, '--port', '99999'], { encoding: 'utf8' });
  ok(badPort.status === 1 && /invalid port/.test(badPort.stderr), 'an invalid port is refused');

  // serving
  const a = start(['--no-browser', '--port', String(PORT), song]);
  await a.ready;
  ok(/running at http:\/\/127\.0\.0\.1:18321\//.test(a.out.text), 'it reports the address it is listening on');
  const index = await get(PORT, '/');
  ok(index.status === 200 && /<title>Tracklight<\/title>/.test(index.body.toString()) && /text\/html/.test(index.headers['content-type']) && index.headers['cache-control'] === 'no-store', 'GET / serves the app with no-store caching');
  ok((await get(PORT, '/index.html')).status === 200, 'GET /index.html serves the app too');
  const opened = await get(PORT, '/__open/' + encodeURIComponent('my song.mod'));
  ok(opened.status === 200 && opened.body.equals(songBytes), 'the file given on the command line is served byte for byte (name with a space)');
  ok((await get(PORT, '/__open/other.mod')).status === 404 && (await get(PORT, '/__open/')).status === 404, 'only that exact file name is served');

  // nothing else on disk is reachable
  const probes = ['/serve.js', '/test.js', '/tracklight.cmd', '/../serve.js', '/%2e%2e/serve.js', '/..%2f..%2fwindows/win.ini', '/__open/..%2fsecret.txt', '/.git/config', '/__open/' + encodeURIComponent('../secret.txt')];
  const results = await Promise.all(probes.map(p => get(PORT, p)));
  ok(results.every(r => r.status === 404 || r.status === 400) && results.every(r => !/top secret|require\('http'\)|createServer/.test(r.body.toString())), 'source files, parent folders and traversal tricks are never served');
const dots = await get(PORT, '/__open/../index.html');
ok(dots.status === 200 && /<title>Tracklight<\/title>/.test(dots.body.toString()) && !/createServer/.test(dots.body.toString()), 'a ../ trick from /__open/ only ever lands on the public app page');

  // only localhost may talk to it, and only with GET/HEAD
  ok((await get(PORT, '/', { host: 'evil.example.com' })).status === 403, 'a request with a foreign Host header is refused (DNS rebinding)');
  ok((await get(PORT, '/', { host: '127.0.0.1:9999' })).status === 403, 'a Host header with the wrong port is refused');
  ok((await get(PORT, '/', { host: 'localhost:' + PORT })).status === 200, 'localhost is accepted as a host name');
  ok((await get(PORT, '/', { method: 'POST' })).status === 405 && (await get(PORT, '/', { method: 'PUT' })).status === 405 && (await get(PORT, '/__ping', { method: 'DELETE' })).status === 405, 'only GET and HEAD are allowed');
  ok((await get(PORT, '/__ping')).status === 204 && (await get(PORT, '/__tracklight')).body.toString() === 'tracklight', 'the ping and identity endpoints answer');

  // a second launch without a file reuses nothing here (a file is open), so it moves to the next port
  const b = start(['--no-browser', '--port', String(PORT)]);
  await b.ready;
  ok(/already running on port 18321/.test(b.out.text), 'starting again without a file reuses the running server instead of a new one');
  ok((await b.exited) === 0, 'the second launch exits cleanly, leaving the first running');
  ok((await get(PORT, '/')).status === 200, 'the first server is still serving');
  const c = start(['--no-browser', '--port', String(PORT), song]);
  await c.ready;
  ok(/running at http:\/\/127\.0\.0\.1:18322\//.test(c.out.text), 'a launch with its own file takes the next free port rather than clashing');
  c.child.kill('SIGINT'); await c.exited;
  a.child.kill('SIGINT');
  const aCode = await a.exited;
  // on Windows Node ends a child on kill('SIGINT') instead of delivering the signal, so the clean-exit message can only be checked elsewhere
  ok(process.platform === 'win32' ? true : aCode === 0 && /Shutting down/.test(a.out.text), 'Ctrl+C shuts the server down' + (process.platform === 'win32' ? ' (clean-exit message not testable on Windows; checked in a console below)' : ' cleanly'));
  ok((await get(PORT, '/')).status === 0, 'after shutdown the port no longer answers');

  // it quits by itself once the page stops pinging (that is how closing the window ends it)
  const idle = start(['--no-browser', '--exit-when-idle', '--port', '18340'], { TRACKLIGHT_IDLE_MS: '1500' });
  await idle.ready;
  await get(18340, '/__ping');
  const t0 = Date.now();
  const code = await Promise.race([idle.exited, sleep(8000).then(() => 'still running')]);
  ok(code === 0 && /Window closed/.test(idle.out.text) && Date.now() - t0 < 6000, 'the server exits on its own after the page stops pinging (' + (Date.now() - t0) + ' ms)');
  if (code === 'still running') idle.child.kill();

  // while the page keeps pinging it stays up
  const live = start(['--no-browser', '--exit-when-idle', '--port', '18341'], { TRACKLIGHT_IDLE_MS: '1500' });
  await live.ready;
  for (let i = 0; i < 6; i++) { await get(18341, '/__ping'); await sleep(500); }
  ok(live.child.exitCode === null && (await get(18341, '/')).status === 200, 'it keeps running while pings keep arriving');
  live.child.kill('SIGINT'); await live.exited;

  // --keep and plain --no-browser never auto-quit
  const keep = start(['--no-browser', '--port', '18342'], { TRACKLIGHT_IDLE_MS: '800', TRACKLIGHT_STARTUP_MS: '800' });
  await keep.ready;
  await get(18342, '/__ping');
  await sleep(2600);
  ok(keep.child.exitCode === null, 'with --no-browser it does not quit on its own');
  keep.child.kill('SIGINT'); await keep.exited;

  // never connected at all: gives up after the startup grace period
  const never = start(['--no-browser', '--exit-when-idle', '--port', '18343'], { TRACKLIGHT_STARTUP_MS: '1500' });
  await never.ready;
  const code2 = await Promise.race([never.exited, sleep(7000).then(() => 'still running')]);
  ok(code2 === 0 && /No window connected/.test(never.out.text), 'if no window ever connects it shuts down after the startup grace period');
  if (code2 === 'still running') never.child.kill();

  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail);
})();
