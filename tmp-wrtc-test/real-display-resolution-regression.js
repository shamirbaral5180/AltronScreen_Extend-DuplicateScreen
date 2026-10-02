const { app, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dataDir = path.join(__dirname, 'real-display-data');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
const reportPath = path.join(__dirname, 'real-display-report.txt');
const log = (...parts) => {
  const line = `${new Date().toISOString()} ${parts.join(' ')}`;
  process.stdout.write(`${line}\n`);
  fs.appendFileSync(reportPath, `${line}\n`);
};
require('../out/main/bytecode-loader.cjs');
require('../out/main/index.jsc');

app.whenReady().then(async () => {
  const service = global.virtualDisplayService;
  try {
    if (process.platform !== 'win32' || !service.isDriverInstalledSync()) {
      log('REAL_DISPLAY_SKIPPED: driver not installed');
      app.exit(0);
      return;
    }
    const support = service.isSupported();
    log('DRIVER_INSTALLED:', support.driverInstalled);

    const before = screen.getAllDisplays().length;
    log('DISPLAYS_BEFORE_CREATE:', before);

    // Create at the app default (1360x768) exactly like the app does.
    const created = await service.setDisplayCount(1, { width: 1360, height: 768, refreshHz: 60 }, { restartDevice: true });
    assert.equal(created, true, 'create should succeed');
    await new Promise(resolve => setTimeout(resolve, 5000));
    const virtualDisplay = screen.getAllDisplays().find(display => display.size.width === 1360 && display.size.height === 768);
    assert.ok(virtualDisplay, 'the extended display should run at the 1360x768 default');
    log('CREATED_AT_DEFAULT:', `${virtualDisplay.size.width}x${virtualDisplay.size.height}`);

    // The advertised XML must contain the standard sizes so Windows can switch.
    const xml = fs.readFileSync('C:\\VirtualDisplayDriver\\vdd_settings.xml', 'utf8');
    const widths = [...xml.matchAll(/<width>(\d+)<\/width>/g)].map(match => Number(match[1]));
    assert.ok(widths.length >= 4, 'multiple resolutions must be advertised');
    assert.equal(widths[0], 1360, '1360x768 advertised first');
    assert.ok(widths.includes(1920) && widths.includes(2560), '1920 and 2560 must be available to Windows');
    log('ADVERTISED_WIDTHS:', JSON.stringify(widths));

    // Removal must NOT restart the device (this is what caused the freeze).
    const removed = await service.destroyDisplay();
    assert.equal(removed, true, 'soft removal should succeed');
    await new Promise(resolve => setTimeout(resolve, 4000));
    log('AFTER_REMOVAL_DISPLAYS:', screen.getAllDisplays().length, 'was before:', before);
    log('REAL_DISPLAY_RESOLUTION_REGRESSION_PASS');
    app.exit(0);
  } catch (error) {
    log('REAL_DISPLAY_RESOLUTION_REGRESSION_FAIL:', error);
    await service.destroyDisplaySilently().catch(() => undefined);
    app.exit(1);
  }
});
