const { app, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const dataDir = path.join(__dirname, 'add-after-remove-data');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
const report = path.join(__dirname, 'add-after-remove-report.txt');
const log = (...p) => { const l = `${new Date().toISOString()} ${p.join(' ')}`; process.stdout.write(l + '\n'); fs.appendFileSync(report, l + '\n'); };
const labels = () => screen.getAllDisplays().map(d => d.label || 'unknown').join(', ');
require('../out/main/bytecode-loader.cjs');
const { altronscreenApp } = require('../out/main/index.jsc');
altronscreenApp.ensureVirtualDisplayDriver = async () => {};
const service = global.virtualDisplayService;
app.whenReady().then(async () => {
  try {
    if (process.platform !== 'win32' || !(await service.isDriverInstalled())) { log('SKIP'); app.exit(0); return; }
    log('START', labels());
    log('setDisplayCount(1):', await service.setDisplayCount(1, { width: 1360, height: 768, refreshHz: 60 }));
    for (let i = 0; i < 40 && !screen.getAllDisplays().some(d => /VDD/i.test(d.label || '')); i++) await new Promise(r => setTimeout(r, 300));
    log('AFTER_ADD', labels());
    log('setDisplayCount(2):', await service.setDisplayCount(2, { width: 1360, height: 768, refreshHz: 60 }));
    await new Promise(r => setTimeout(r, 4000));
    log('AFTER_ADD_2', labels());
    log('destroyDisplay:', await service.destroyDisplay());
    await new Promise(r => setTimeout(r, 3000));
    log('AFTER_REMOVE', labels());
    app.exit(0);
  } catch (e) { log('FAIL', String(e)); app.exit(1); }
});
