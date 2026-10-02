const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const dataDir = path.join(__dirname, 'startup-timing-data');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
const t0 = Date.now();
const report = path.join(__dirname, 'startup-timing-report.txt');
const log = (...p) => { const l = `${Date.now() - t0}ms ${p.join(' ')}`; process.stdout.write(l + '\n'); fs.appendFileSync(report, l + '\n'); };
log('process start');
require('../out/main/bytecode-loader.cjs');
require('../out/main/index.jsc');
app.on('browser-window-created', (_, win) => {
  log('window created');
  win.once('ready-to-show', () => log('ready-to-show'));
  win.webContents.once('did-finish-load', () => log('did-finish-load'));
});
// Poll for the window actually being shown.
const poll = setInterval(() => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && win.isVisible()) { log('window VISIBLE'); clearInterval(poll); setTimeout(() => app.exit(0), 500); }
}, 50);
setTimeout(() => { log('timeout'); app.exit(0); }, 15000);
