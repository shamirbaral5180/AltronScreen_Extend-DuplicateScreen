# AltronScreen - one-shot Virtual Display Driver (VDD) installer.
# Downloads, extracts, installs the signed driver package, and creates the
# root-enumerated device. Idempotent. Prints a clear RESULT line at the end so
# the caller (and the user) can see exactly what happened.
$ErrorActionPreference = 'Stop'

$workDir = Join-Path $env:TEMP 'AltronScreenVDD'
$extracted = Join-Path $workDir 'extracted'
$logFile = Join-Path $workDir 'install-log.txt'
New-Item -ItemType Directory -Path $workDir -Force | Out-Null

function Log($msg) {
    $line = "$(Get-Date -Format 'HH:mm:ss')  $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

# ---------- 1. Download ----------
Log 'Downloading latest VDD release...'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$api = 'https://api.github.com/repos/VirtualDrivers/Virtual-Display-Driver/releases/latest'
$release = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'AltronScreen' }
$asset = $release.assets | Where-Object { $_.name -match '^VDD\.Control\..*\.zip$' } | Select-Object -First 1
if (-not $asset) { Log 'RESULT:FAIL:no zip asset found'; exit 1 }

$zip = Join-Path $workDir 'vdd.zip'
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
Log "Downloaded $($asset.name)"

# ---------- 2. Extract ----------
Log 'Extracting...'
if (Test-Path $extracted) { Remove-Item $extracted -Recurse -Force }
Expand-Archive -LiteralPath $zip -DestinationPath $extracted -Force

# ---------- 3. Locate driver ----------
$arch = if ($env:PROCESSOR_ARCHITECTURE -match 'arm') { 'ARM64' } else { 'x86' }
$driverDir = Join-Path $extracted "SignedDrivers\$arch\VDD"
$inf = Join-Path $driverDir 'MttVDD.inf'
$settings = Join-Path $driverDir 'vdd_settings.xml'
if (-not (Test-Path $inf)) {
    Log "RESULT:FAIL:INF not found at $inf"
    exit 1
}

$hwId = 'Root\MttVDD'
$configDir = 'C:\VirtualDisplayDriver'

# ---------- 4. Settings ----------
if (-not (Test-Path $configDir)) { New-Item -ItemType Directory -Path $configDir -Force | Out-Null }
$configFile = Join-Path $configDir 'vdd_settings.xml'
if (-not (Test-Path $configFile)) {
    Copy-Item -Path $settings -Destination $configFile
}
Log 'Copied vdd_settings.xml'

# ---------- 5. Add driver package ----------
Log 'Adding driver package (pnputil)...'
$pnputilOut = & pnputil.exe /add-driver $inf /install 2>&1
$packageExit = $LASTEXITCODE
$pnputilOut | ForEach-Object { Log $_ }
if ($packageExit -ne 0 -and $packageExit -ne 3010) { Log 'RESULT:FAIL:driver package installation failed'; exit 1 }

# ---------- 6. Create device ----------
$devcon = Join-Path $extracted 'Dependencies\devcon.exe'
if (-not (Test-Path $devcon)) { $devcon = Join-Path $driverDir 'devcon.exe' }

# Check whether the root device already exists.
$deviceExists = $false
$enumOut = & pnputil.exe /enum-devices /connected /deviceids 2>&1
if ($enumOut -match [regex]::Escape($hwId)) { $deviceExists = $true }

if (-not $deviceExists -and (Test-Path $devcon)) {
    Log "Creating device $hwId (devcon)..."
    $devconOut = & $devcon install $inf $hwId 2>&1
    $devconOut | ForEach-Object { Log $_ }
} elseif (-not $deviceExists) {
    Log 'WARN: device not present and devcon.exe not found'
} else {
    Log 'Device already present'
}

# ---------- 7. Verify ----------
Start-Sleep -Seconds 3
$deviceExists = $false
$enumOut = & pnputil.exe /enum-devices /connected /deviceids 2>&1
if ($enumOut -match [regex]::Escape($hwId)) { $deviceExists = $true }

if ($deviceExists) {
    Log 'RESULT:OK:driver installed successfully'
    exit 0
}

Log 'RESULT:FAIL:driver device not detected after install'
exit 1
