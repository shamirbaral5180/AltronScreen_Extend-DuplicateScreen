const { app, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const dataDir = path.join(__dirname, 'add-remove-probe-data');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
const report = path.join(__dirname, 'add-remove-probe-report.txt');
const log = (...p) => { const l = `${new Date().toISOString()} ${p.join(' ')}`; process.stdout.write(l + '\n'); fs.appendFileSync(report, l + '\n'); };
const vdd = () => screen.getAllDisplays().filter(d => /VDD/i.test(d.label || '')).length;
const total = () => screen.getAllDisplays().length;
const settle = async (ms) => { for (let i = 0; i < ms / 250; i++) await new Promise(r => setTimeout(r, 250)); };

require('../out/main/bytecode-loader.cjs');
const { altronscreenApp } = require('../out/main/index.jsc');
altronscreenApp.ensureVirtualDisplayDriver = async () => {};
const service = global.virtualDisplayService;

app.whenReady().then(async () => {
  try {
    if (process.platform !== 'win32' || !(await service.isDriverInstalled())) { log('SKIP'); app.exit(0); return; }
    // Clean start.
    await service.destroyDisplay();
    await settle(3000);
    log('START total=', total(), 'vdd=', vdd());

    // Simulate three AddVirtualDisplay clicks using the live count (the fix).
    for (let click = 1; click <= 3; click++) {
      const current = service.countActiveVirtualMonitors();
      await service.setDisplayCount(current + 1, { width: 1360, height: 768, refreshHz: 60 });
      await settle(4000);
      log(`ADD ${click}: vdd=${vdd()} total=${total()}`);
    }

    // Simulate three RemoveVirtualDisplay clicks.
    for (let click = 1; click <= 3; click++) {
      const current = service.countActiveVirtualMonitors();
      const next = current - 1;
      await service.setDisplayCount(next > 0 ? next : 0, { width: 1360, height: 768, refreshHz: 60 });
      await settle(4000);
      log(`REMOVE ${click}: (was ${current} -> ${next}) vdd=${vdd()} total=${total()}`);
    }

    log('FINAL total=', total(), 'vdd=', vdd());
    app.exit(0);
  } catch (e) { log('FAIL', String(e)); app.exit(1); }
});
