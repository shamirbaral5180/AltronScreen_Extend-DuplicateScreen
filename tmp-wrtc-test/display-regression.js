const { app } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const childProcess = require('node:child_process');
const fixture = path.join(__dirname, 'mock-vdd-settings.xml');
const testPipe = `\\\\.\\pipe\\AltronScreenRegression${process.pid}`;
const commands = [];
const restarts = [];
let failUpdate = false;
const originalConnect = net.connect;
net.connect = function (address, ...args) {
  return originalConnect.call(this, address === '\\\\.\\pipe\\MTTVirtualDisplayPipe' ? testPipe : address, ...args);
};
const originalExecFile = childProcess.execFile;
childProcess.execFile = function (file, args, options, callback) {
  if (file === 'pnputil.exe' || file === 'DisplaySwitch.exe') {
    restarts.push([file, args]);
    queueMicrotask(() => callback(null, '', ''));
    return {};
  }
  return originalExecFile.call(this, file, args, options, callback);
};
const server = net.createServer((socket) => {
  socket.once('data', (buffer) => {
    const command = buffer.toString('utf16le').replace(/\0/g, '');
    commands.push(command);
    if (command === 'PING') return socket.end('PONG');
    if (command.startsWith('SETDISPLAYCOUNT ')) {
      if (failUpdate) return socket.end('Failed to update display count setting in XML');
      const count = Number(command.split(' ')[1]);
      const xml = fs.readFileSync(fixture, 'utf8').replace(/<count>\d+<\/count>/, `<count>${count}</count>`);
      fs.writeFileSync(fixture, xml);
      return socket.end();
    }
    socket.end('Unknown command');
  });
});

require('../out/main/bytecode-loader.cjs');
const { altronscreenApp } = require('../out/main/index.jsc');
altronscreenApp.ensureVirtualDisplayDriver = async () => {};
const service = global.virtualDisplayService;
service.resolveConfigPath = () => fixture;
service.destroyDisplaySilently = async () => {};

app.whenReady().then(async () => {
  try {
    fs.writeFileSync(fixture, '<vdd_settings><monitors><count>0</count></monitors></vdd_settings>');
    await new Promise((resolve) => server.listen(testPipe, resolve));
    assert.equal(await service.ping(), true, 'UTF-8 PONG response');
    for (let count = 1; count <= 3; count++) {
      const next = (await service.getActiveDisplayCount()) + 1;
      assert.equal(next, count);
      assert.equal(await service.setDisplayCount(next, { width: 1920, height: 1080 }), true);
      assert.equal(await service.getActiveDisplayCount(), count);
    }
    assert.equal(await service.destroyDisplay(), true);
    assert.equal(await service.getActiveDisplayCount(), 0);
    failUpdate = true;
    assert.equal(await service.setDisplayCount(1), false, 'driver errors must not report success');
    assert.equal(commands.includes('GETDISPLAYCOUNT'), false);
    assert.equal(restarts.filter(([file]) => file === 'pnputil.exe').length, 4);
    console.log('DISPLAY_REGRESSION_PASS:', JSON.stringify({ commands, restarts: restarts.length }));
    fs.unlinkSync(fixture);
    server.close();
    app.exit(0);
  } catch (error) {
    console.error('DISPLAY_REGRESSION_FAIL:', error);
    app.exit(1);
  }
});
