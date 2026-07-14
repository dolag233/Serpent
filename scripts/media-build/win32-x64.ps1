$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
Set-StrictMode -Version Latest

if (-not $IsWindows -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
  throw 'This build must run natively on Windows x64.'
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$Lock = Get-Content (Join-Path $Root 'resources/media-binaries/source-lock.json') -Raw | ConvertFrom-Json
$ManifestRoot = Join-Path $Root 'resources/media-binaries/vcpkg'
$Work = if ($env:SERPENT_MEDIA_BUILD_DIR) { $env:SERPENT_MEDIA_BUILD_DIR } else { Join-Path $Root '.media-build/win32-x64' }
$VcpkgRoot = Join-Path $Work 'vcpkg'
$OverlayRoot = Join-Path $Work 'overlay-ports'
$InstalledRoot = Join-Path $Work 'vcpkg-installed'
$ArtifactRoot = Join-Path $Root 'artifacts/media-binaries'
$Triplet = 'serpent-x64-windows-static'
New-Item -ItemType Directory -Force $Work, $ArtifactRoot | Out-Null

if (-not (Test-Path (Join-Path $VcpkgRoot '.git'))) {
  git clone --filter=blob:none --no-checkout $Lock.registry.repository $VcpkgRoot
  if ($LASTEXITCODE -ne 0) { throw 'vcpkg clone failed.' }
}
git -C $VcpkgRoot fetch --force --depth 1 origin "refs/tags/$($Lock.registry.tag):refs/tags/$($Lock.registry.tag)"
if ($LASTEXITCODE -ne 0) { throw 'vcpkg fetch failed.' }
git -C $VcpkgRoot checkout --detach --force $Lock.registry.commit
if ($LASTEXITCODE -ne 0) { throw 'vcpkg checkout failed.' }
$ActualCommit = (git -C $VcpkgRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect vcpkg checkout.' }
if ($ActualCommit -ne $Lock.registry.commit) { throw 'vcpkg checkout does not match source-lock.json.' }

& (Join-Path $VcpkgRoot 'bootstrap-vcpkg.bat') -disableMetrics
if ($LASTEXITCODE -ne 0) { throw 'vcpkg bootstrap failed.' }
node (Join-Path $Root 'scripts/media-build/prepare-vcpkg-overlay.mjs') `
  --vcpkg-root $VcpkgRoot --output $OverlayRoot
if ($LASTEXITCODE -ne 0) { throw 'vcpkg overlay preparation failed.' }

Remove-Item -Recurse -Force $InstalledRoot -ErrorAction SilentlyContinue
$env:VCPKG_DISABLE_METRICS = '1'
$env:VCPKG_FEATURE_FLAGS = 'manifests,versions'
$env:VCPKG_BINARY_SOURCES = 'clear'
& (Join-Path $VcpkgRoot 'vcpkg.exe') install `
  "--x-manifest-root=$ManifestRoot" `
  "--x-install-root=$InstalledRoot" `
  "--triplet=$Triplet" `
  "--overlay-ports=$OverlayRoot"
if ($LASTEXITCODE -ne 0) { throw 'vcpkg media dependency build failed.' }

node (Join-Path $Root 'scripts/media-build/stage-vcpkg-bundle.mjs') `
  --platform win32-x64 --triplet $Triplet `
  --installed-root $InstalledRoot --vcpkg-root $VcpkgRoot `
  --resource-root (Join-Path $Root 'resources')
if ($LASTEXITCODE -ne 0) { throw 'Media bundle staging or verification failed.' }

$BundleRoot = Join-Path $Work 'bundle-root'
$Archive = Join-Path $ArtifactRoot 'serpent-media-win32-x64.zip'
$ManifestChecksum = Join-Path $ArtifactRoot 'serpent-media-win32-x64.manifest.sha256'
Remove-Item -Recurse -Force $BundleRoot -ErrorAction SilentlyContinue
Remove-Item -Force $Archive, "$Archive.sha256", $ManifestChecksum -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force `
  (Join-Path $BundleRoot 'ffmpeg'), `
  (Join-Path $BundleRoot 'oiio'), `
  (Join-Path $BundleRoot 'media-binaries') | Out-Null
Copy-Item -Recurse (Join-Path $Root 'resources/ffmpeg/win32-x64') (Join-Path $BundleRoot 'ffmpeg')
Copy-Item -Recurse (Join-Path $Root 'resources/oiio/win32-x64') (Join-Path $BundleRoot 'oiio')
Copy-Item -Recurse (Join-Path $Root 'resources/media-binaries/win32-x64') (Join-Path $BundleRoot 'media-binaries')
Copy-Item (Join-Path $Root 'resources/media-binaries/source-lock.json') (Join-Path $BundleRoot 'media-binaries')
Compress-Archive -Path (Join-Path $BundleRoot '*') -DestinationPath $Archive -CompressionLevel Optimal
$Hash = (Get-FileHash -Algorithm SHA256 $Archive).Hash.ToLowerInvariant()
Set-Content -NoNewline -Path "$Archive.sha256" -Value "$Hash  $([IO.Path]::GetFileName($Archive))`n"
$ManifestPath = Join-Path $Root 'resources/media-binaries/win32-x64/manifest.json'
$ManifestHash = (Get-FileHash -Algorithm SHA256 $ManifestPath).Hash.ToLowerInvariant()
Set-Content -NoNewline -Path $ManifestChecksum -Value "$ManifestHash  manifest.json`n"
Write-Host "Built $Archive"
