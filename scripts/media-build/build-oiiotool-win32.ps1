$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
  throw 'This build must run natively on Windows x64.'
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$Lock = Get-Content (Join-Path $Root 'resources/media-binaries/source-lock.json') -Raw | ConvertFrom-Json
$ManifestRoot = Join-Path $Root 'resources/media-binaries/vcpkg'
$DefaultWork = Join-Path $env:LOCALAPPDATA 'SerpentMediaBuild\win32-x64'
$Work = if ($env:SERPENT_MEDIA_BUILD_DIR) { $env:SERPENT_MEDIA_BUILD_DIR } else { $DefaultWork }
$VcpkgRoot = Join-Path $Work 'vcpkg'
$OverlayRoot = Join-Path $Work 'overlay-ports'
$InstalledRoot = Join-Path $Work 'vcpkg-installed'
$Triplet = 'serpent-x64-windows-static'
$env:VCPKG_ROOT = $VcpkgRoot
New-Item -ItemType Directory -Force $Work | Out-Null

if (-not (Test-Path (Join-Path $VcpkgRoot '.git'))) {
  git clone --filter=blob:none --no-checkout $Lock.registry.repository $VcpkgRoot
  if ($LASTEXITCODE -ne 0) { throw 'vcpkg clone failed.' }
}
git -C $VcpkgRoot fetch --force --depth 1 origin "refs/tags/$($Lock.registry.tag):refs/tags/$($Lock.registry.tag)"
if ($LASTEXITCODE -ne 0) { throw 'vcpkg fetch failed.' }
git -C $VcpkgRoot checkout --force --detach $Lock.registry.commit
if ($LASTEXITCODE -ne 0) { throw 'vcpkg checkout failed.' }

$VcpkgToolPath = Join-Path $VcpkgRoot 'vcpkg.exe'
if (-not (Test-Path -LiteralPath $VcpkgToolPath)) {
  $VcpkgToolUrl = $Lock.vcpkgTool.windowsX64.url
  $ExpectedVcpkgHash = $Lock.vcpkgTool.windowsX64.sha256
  $DownloadPath = Join-Path $env:TEMP 'serpent-vcpkg.exe'
  Invoke-WebRequest -Uri $VcpkgToolUrl -OutFile $DownloadPath
  $DownloadedHash = (Get-FileHash -LiteralPath $DownloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($DownloadedHash -ne $ExpectedVcpkgHash) {
    Remove-Item -LiteralPath $DownloadPath -Force -ErrorAction SilentlyContinue
    throw 'Pinned Windows vcpkg tool checksum does not match source-lock.json.'
  }
  Move-Item -LiteralPath $DownloadPath -Destination $VcpkgToolPath -Force
}
& $VcpkgToolPath version --disable-metrics
if ($LASTEXITCODE -ne 0) { throw 'Pinned Windows vcpkg tool cannot run.' }
node (Join-Path $Root 'scripts/media-build/prepare-vcpkg-overlay.mjs') `
  --vcpkg-root $VcpkgRoot --output $OverlayRoot
if ($LASTEXITCODE -ne 0) { throw 'vcpkg overlay preparation failed.' }

$env:VCPKG_DISABLE_METRICS = '1'
$env:VCPKG_FEATURE_FLAGS = 'manifests,versions'
$env:VCPKG_BINARY_SOURCES = 'clear'

Write-Host 'Installing openimageio (oiiotool only; ffmpeg comes from BtbN LGPL builds)...'
# vcpkg 工具可用本机安装（D:\vcpkg\vcpkg.exe）或 $VcpkgRoot 内自备；
# triplet 定义在主仓 resources/media-binaries/vcpkg/triplets/
& $VcpkgToolPath install 'openimageio' `
  "--x-install-root=$InstalledRoot" `
  "--triplet=$Triplet" `
  "--overlay-ports=$OverlayRoot" `
  "--overlay-triplets=$(Join-Path $Root 'resources/media-binaries/vcpkg/triplets')"
if ($LASTEXITCODE -ne 0) { throw 'vcpkg openimageio install failed.' }

$Tool = Get-ChildItem -Path $InstalledRoot -Recurse -Filter 'oiiotool.exe' -File | Select-Object -First 1
if (-not $Tool) { throw 'oiiotool.exe not found under vcpkg-installed.' }
$TargetDir = Join-Path $Root 'resources/oiio/win32-x64'
New-Item -ItemType Directory -Force $TargetDir | Out-Null
Copy-Item -LiteralPath $Tool.FullName -Destination (Join-Path $TargetDir 'oiiotool.exe') -Force
Write-Host "oiiotool copied to $TargetDir\oiiotool.exe"
