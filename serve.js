#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Jmze-ui
// Tracklight launcher: serves index.html on localhost and opens it in a browser window.
// No dependencies. Usage: node serve.js [song.mod|project.tlp] [--port N] [--no-browser] [--keep] [--browser PATH]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const INDEX = path.join(__dirname, 'index.html');
const DEFAULT_PORT = 8321;
const MAX_OPEN_BYTES = 64 * 1024 * 1024;

const HELP = `Tracklight - tracker module player and editor

Usage:
  tracklight [file] [options]

  file                 a .mod song or .tlp project to open on start
  --port N             preferred port (default ${DEFAULT_PORT}; the next free one is used if busy)
  --no-browser         only run the server, do not open a window
  --keep               keep running after the window is closed
  --exit-when-idle     quit when the page stops answering (default when a window is opened)
  --browser PATH       browser to open (a Chromium browser gets a standalone app window)
  -h, --help           this text

The server listens on 127.0.0.1 only. Close the window or press Ctrl+C to quit.`;

function parseArgs(argv) {
  const o = { file: null, port: DEFAULT_PORT, browser: null, openBrowser: true, keep: false, forceIdle: false, help: false, error: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--no-browser') o.openBrowser = false;
    else if (a === '--keep') o.keep = true;
    else if (a === '--exit-when-idle') o.forceIdle = true;
    else if (a === '--port' || a === '--browser') {
      const v = argv[++i];
      if (v === undefined) o.error = a + ' needs a value';
      else if (a === '--port') { const n = Number(v); if (Number.isInteger(n) && n > 0 && n < 65536) o.port = n; else o.error = 'invalid port: ' + v; }
      else o.browser = v;
    } else if (a.startsWith('-')) o.error = 'unknown option: ' + a;
    else if (o.file) o.error = 'only one file can be opened at a time';
    else o.file = a;
  }
  return o;
}

const allowedHost = (host, port) => host === '127.0.0.1:' + port || host === 'localhost:' + port;

function sendFile(res, file, type) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
    res.end(data);
  });
}

// Only index.html, the one file given on the command line, and two tiny control endpoints are ever served.
function createServer(openFile, state) {
  const server = http.createServer((req, res) => {
    if (!allowedHost(req.headers.host || '', server.address().port)) { res.writeHead(403); res.end('Forbidden'); return; }   // blocks DNS rebinding
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end(); return; }
    if (p === '/' || p === '/index.html') sendFile(res, INDEX, 'text/html; charset=utf-8');
    else if (p === '/__tracklight') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('tracklight'); }
    else if (p === '/__ping') { state.pinged = true; state.lastPing = Date.now(); res.writeHead(204); res.end(); }
    else if (openFile && p === '/__open/' + openFile.name) sendFile(res, openFile.path, 'application/octet-stream');
    else { res.writeHead(404); res.end('Not found'); }
  });
  return server;
}

function tryListen(server, port) {
  return new Promise(resolve => {
    const onError = e => resolve(e.code === 'EADDRINUSE' ? 'busy' : 'error');
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', onError); resolve('ok'); });
  });
}

function isTracklight(port) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/__tracklight', timeout: 1500 }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve(body === 'tracklight'));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function findChromium(override) {
  if (override) return fs.existsSync(override) ? override : null;
  const env = process.env, cands = [];
  if (process.platform === 'win32') {
    for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean)) {
      cands.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
    for (const exe of ['msedge.exe', 'chrome.exe']) for (const hive of ['HKLM', 'HKCU']) {
      try {
        const out = cp.execFileSync('reg', ['query', hive + '\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\' + exe, '/ve'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const m = out.match(/REG_SZ\s+(.+)/);
        if (m) cands.push(m[1].trim().replace(/^"|"$/g, ''));
      } catch (e) { /* not registered */ }
    }
  } else if (process.platform === 'darwin') {
    cands.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    for (const d of (env.PATH || '').split(':')) for (const n of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) cands.push(path.join(d, n));
  }
  return cands.find(c => fs.existsSync(c)) || null;
}

function launch(url, opts) {
  const exe = findChromium(opts.browser);
  if (exe) {
    const profile = path.join(process.env.LOCALAPPDATA || process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Tracklight', 'profile');
    // a dedicated profile makes the browser start its own instance (so --app is honoured) and keeps your settings in one place
    cp.spawn(exe, ['--app=' + url, '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--window-size=1280,860'], { detached: true, stdio: 'ignore' }).unref();
    return 'app window (' + path.basename(exe) + ')';
  }
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  cp.spawn(cmd, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  return 'your default browser (for a standalone window install Edge or Chrome, or pass --browser PATH)';
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(HELP); return 0; }
  if (o.error) { console.error('tracklight: ' + o.error + '\n\n' + HELP); return 1; }
  if (!fs.existsSync(INDEX)) { console.error('tracklight: index.html not found next to serve.js'); return 1; }

  let openFile = null;
  if (o.file) {
    const full = path.resolve(process.cwd(), o.file);
    let st;
    try { st = fs.statSync(full); } catch (e) { console.error('tracklight: cannot find ' + o.file); return 1; }
    if (!st.isFile()) { console.error('tracklight: ' + o.file + ' is not a file'); return 1; }
    if (st.size > MAX_OPEN_BYTES) { console.error('tracklight: ' + o.file + ' is too large'); return 1; }
    openFile = { name: path.basename(full), path: full };
  }

  const state = { pinged: false, lastPing: 0, started: Date.now() };
  const server = createServer(openFile, state);
  let port = 0, reuse = false;
  for (let p = o.port; p < o.port + 20; p++) {
    const r = await tryListen(server, p);
    if (r === 'ok') { port = p; break; }
    if (r === 'busy' && !openFile && await isTracklight(p)) { port = p; reuse = true; break; }   // already running: just open another window
    if (r === 'error') { console.error('tracklight: could not start the server'); return 1; }
  }
  if (!port) { console.error('tracklight: no free port found near ' + o.port); return 1; }

  const url = 'http://127.0.0.1:' + port + '/' + (openFile ? '?open=/__open/' + encodeURIComponent(openFile.name) : '');
  if (reuse) {
    console.log('Tracklight is already running on port ' + port + '.');
    if (o.openBrowser) console.log('Opened ' + launch(url, o) + '.');
    return 0;
  }
  console.log('Tracklight running at http://127.0.0.1:' + port + '/');
  if (openFile) console.log('Opening ' + openFile.name);
  if (o.openBrowser) console.log('Opened ' + launch(url, o) + '.');
  const autoExit = !o.keep && (o.openBrowser || o.forceIdle);
  console.log(autoExit ? 'Close the window to quit (or press Ctrl+C).' : 'Press Ctrl+C to quit.');

  // the page pings every few seconds; when it stops, the window is gone
  const idleMs = Number(process.env.TRACKLIGHT_IDLE_MS) || 15000, startupMs = Number(process.env.TRACKLIGHT_STARTUP_MS) || 120000;
  const quit = why => { console.log(why); server.close(); setTimeout(() => process.exit(0), 200); };
  if (autoExit) {
    setInterval(() => {
      const now = Date.now();
      if (state.pinged && now - state.lastPing > idleMs) quit('Window closed, shutting down.');
      else if (!state.pinged && now - state.started > startupMs) quit('No window connected, shutting down.');
    }, 1000).unref();
  }
  process.on('SIGINT', () => quit('Shutting down.'));
  return null;
}

main().then(code => { if (code !== null) process.exit(code); }, e => { console.error('tracklight: ' + e.message); process.exit(1); });
