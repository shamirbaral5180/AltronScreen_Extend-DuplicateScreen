const { app, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const dataDir = path.join(__dirname, 'doubling-probe-data');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
const report = path.join(__dirname, 'doubling-probe-report.txt');
const log = (...p) => { const l = `${new Date().toISOString()} ${p.join(' ')}`; process.stdout.write(l + '\n'); fs.appendFileSync(report, l + '\n'); };
const labels = () => screen.getAllDisplays().map(d => d.label || 'unknown').join(' | ');
const xmlCount = () => { try { return (fs.readFileSync('C:\\VirtualDisplayDriver\\vdd_settings.xml', 'utf8').match(/<count>(\d+)<\/count>/) || [])[1]; } catch { return 'n/a'; } };
require('../out/main/bytecode-loader.cjs');
const { altronscreenApp } = require('../out/main/index.jsc');
altronscreenApp.ensureVirtualDisplayDriver = async () => {};
const service = global.virtualDisplayService;
app.whenReady().then(async () => {
  try {
    if (process.platform !== 'win32' || !(await service.isDriverInstalled())) { log('SKIP'); app.exit(0); return; }
    log('START', labels(), 'xml=', xmlCount());
    // Simulate the app's AddVirtualDisplay: currentCount from XML, next = +1.
    for (let click = 1; click <= 3; click++) {
      const current = await service.getActiveDisplayCount().catch(() => 0);
      const next = (Number.isFinite(current) ? current : 0) + 1;
      log(`CLICK ${click}: current=${current} next=${next}`);
      await service.setDisplayCount(next, { width: 1360, height: 768, refreshHz: 60 });
      await new Promise(r => setTimeout(r, 5000));
      log(`  after click ${click}:`, labels(), 'xml=', xmlCount());
    }
    app.exit(0);
  } catch (e) { log('FAIL', String(e)); app.exit(1); }
});
