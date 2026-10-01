# AltronScreen - fully install the Virtual Display Driver (VDD).
# Must be run elevated. Idempotent and tolerant of already-installed state.
$ErrorActionPreference = 'Continue'

$workDir = Join-Path $env:TEMP 'AltronScreenVDD'
$extracted = Join-Path $workDir 'extracted'

$arch = if ($env:PROCESSOR_ARCHITECTURE -match 'arm') { 'ARM64' } else { 'x86' }
$driverDir = Join-Path $extracted "SignedDrivers\$arch\VDD"
$inf = Join-Path $driverDir 'MttVDD.inf'
$settings = Join-Path $driverDir 'vdd_settings.xml'

if (-not (Test-Path $inf)) {
    Write-Host "      [ERROR] Driver INF not found at $inf"
    exit 1
}

$hwId = 'Root\MttVDD'
$configDir = 'C:\VirtualDisplayDriver'
$installedDll = Join-Path $env:SystemRoot 'System32\drivers\UMDF\MttVDD.dll'

# 1. Write driver settings where the driver reads them at runtime.
if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
}
Copy-Item -Path $settings -Destination (Join-Path $configDir 'vdd_settings.xml') -Force
Write-Host '      Copied vdd_settings.xml to C:\VirtualDisplayDriver\'

# If the driver DLL is already present, we are effectively done.
if (Test-Path $installedDll) {
    Write-Host '      Driver is already installed.'
    exit 0
}

# 2. Add the signed driver package (idempotent - "already exists" is fine).
Write-Host '      Adding the driver package...'
$pnputil = Get-Command pnputil.exe -ErrorAction SilentlyContinue
if ($pnputil) {
    & pnputil.exe /add-driver $inf /install 2>&1 | Out-Host
}

# 3. Create the root-enumerated device with devcon.
$devcon = Join-Path $extracted 'Dependencies\devcon.exe'
if (-not (Test-Path $devcon)) {
    $devcon = Join-Path $driverDir 'devcon.exe'
}

if (Test-Path $devcon) {
    Write-Host "      Creating device $hwId ..."
    & $devcon install $inf $hwId 2>&1 | Out-Host
} else {
    Write-Host '      [WARN] devcon.exe not found; pnputil may have created the device.'
}

# 4. Verify.
Start-Sleep -Seconds 2
if (Test-Path $installedDll) {
    Write-Host '      Virtual Display Driver installation complete.'
    exit 0
}

Write-Host '      [WARN] Driver DLL not detected after install; the device may still be registering.'
exit 0
