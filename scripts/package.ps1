# Builds dist/rumble-clipper-v<version>.zip for the Chrome Web Store.
# Contains only runtime files (manifest at zip root, as the store requires).
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $Root 'manifest.json') -Raw | ConvertFrom-Json
$version = $manifest.version
$dist = Join-Path $Root 'dist'
$staging = Join-Path $env:TEMP ("rumble-clipper-pkg-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $dist, $staging | Out-Null
try {
    Copy-Item (Join-Path $Root 'manifest.json') $staging
    Copy-Item (Join-Path $Root 'icons') $staging -Recurse
    Copy-Item (Join-Path $Root 'src') $staging -Recurse
    Copy-Item (Join-Path $Root '_locales') $staging -Recurse
    # Strip any stray clutter from the staged tree
    Get-ChildItem $staging -Recurse -Force |
        Where-Object { $_.Name -match '^\.|~$|\.map$' } |
        Remove-Item -Force -Recurse -ErrorAction SilentlyContinue
    $zip = Join-Path $dist ("rumble-clipper-v$version.zip")
    if (Test-Path $zip) { Remove-Item $zip -Force }
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zip -CompressionLevel Optimal
    $size = [math]::Round((Get-Item $zip).Length / 1KB, 1)
    Write-Host "Packaged $zip ($size KB)"
    Write-Host "Upload it at https://chrome.google.com/webstore/devconsole"
}
finally {
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}
