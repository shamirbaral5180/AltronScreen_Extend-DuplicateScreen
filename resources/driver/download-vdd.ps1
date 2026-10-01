# AltronScreen - download the latest Virtual Display Driver (VDD) release.
# Writes the archive to %TEMP%\AltronScreenVDD\vdd.zip and prints the path.
$ErrorActionPreference = 'Stop'

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$api = 'https://api.github.com/repos/VirtualDrivers/Virtual-Display-Driver/releases/latest'
$workDir = Join-Path $env:TEMP 'AltronScreenVDD'
if (-not (Test-Path $workDir)) {
    New-Item -ItemType Directory -Path $workDir -Force | Out-Null
}

Write-Host '      Querying the latest VDD release...'
$release = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'AltronScreen' }

$asset = $release.assets | Where-Object { $_.name -match '(?i)\.zip$' } | Select-Object -First 1
if (-not $asset) {
    throw 'No .zip asset found in the latest VDD release.'
}

$out = Join-Path $workDir 'vdd.zip'
Write-Host ('      Downloading: ' + $asset.name)
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $out -UseBasicParsing

Write-Host ('      Saved to: ' + $out)
exit 0
