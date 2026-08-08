$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
  throw 'This build must run natively on Windows x64.'
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$Lock = Get-Content (Join-Path $Root 'resources/media-binaries/source-lock.json') -Raw | ConvertFrom-Json
$ManifestRoot = Join-Path $Root 'resources/media-binaries/vcpkg'
# vcpkg performs frequent atomic directory renames while extracting tools and
# building ports. Keep that generated tree outside an actively indexed source
# checkout on Windows; `SERPENT_MEDIA_BUILD_DIR` remains available for CI.
# 注意：不得使用 `%LOCALAPPDATA%\Serpent` 下的子目录——Squirrel 安装目录
# 恰为 `%LOCALAPPDATA%\<包名>`（serpent，不区分大小写），撞名会让 Squirrel
# 全量安装时尝试删除 vcpkg 构建树而失败（PathTooLongException）。
$DefaultWork = Join-Path $env:LOCALAPPDATA 'SerpentMediaBuild\win32-x64'
$Work = if ($env:SERPENT_MEDIA_BUILD_DIR) { $env:SERPENT_MEDIA_BUILD_DIR } else { $DefaultWork }
$VcpkgRoot = Join-Path $Work 'vcpkg'
$OverlayRoot = Join-Path $Work 'overlay-ports'
$InstalledRoot = Join-Path $Work 'vcpkg-installed'
$ArtifactRoot = Join-Path $Root 'artifacts/media-binaries'
$Triplet = 'serpent-x64-windows-static'
$env:VCPKG_ROOT = $VcpkgRoot
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

$VcpkgTool = $Lock.vcpkgTool
if ($null -eq $VcpkgTool -or $null -eq $VcpkgTool.windowsX64) {
  throw 'source-lock.json is missing the pinned Windows vcpkg tool.'
}
$VcpkgToolPath = Join-Path $VcpkgRoot 'vcpkg.exe'
$ExpectedVcpkgHash = $VcpkgTool.windowsX64.sha256.ToLowerInvariant()
$ActualVcpkgHash = if (Test-Path -LiteralPath $VcpkgToolPath) {
  (Get-FileHash -LiteralPath $VcpkgToolPath -Algorithm SHA256).Hash.ToLowerInvariant()
} else {
  $null
}
if ($ActualVcpkgHash -ne $ExpectedVcpkgHash) {
  $DownloadPath = "$VcpkgToolPath.download"
  Remove-Item -LiteralPath $DownloadPath -Force -ErrorAction SilentlyContinue
  Invoke-WebRequest -Uri $VcpkgTool.windowsX64.url -OutFile $DownloadPath -MaximumRedirection 5
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

Remove-Item -Recurse -Force $InstalledRoot -ErrorAction SilentlyContinue
$env:VCPKG_DISABLE_METRICS = '1'
$env:VCPKG_FEATURE_FLAGS = 'manifests,versions'
$env:VCPKG_BINARY_SOURCES = 'clear'

function RepairCompletedVcpkgToolExtractions {
  $ToolsRoot = Join-Path $VcpkgRoot 'downloads/tools'
  if (-not (Test-Path -LiteralPath $ToolsRoot)) { return $false }
  $Recovered = $false
  $Partials = Get-ChildItem -LiteralPath $ToolsRoot -Directory |
    Where-Object { $_.Name -match '^.+-windows\.partial\.\d+$' } |
    Sort-Object LastWriteTime
  foreach ($Partial in $Partials) {
    $FinalPath = $Partial.FullName -replace '\.partial\.\d+$', ''
    if (Test-Path -LiteralPath $FinalPath) { continue }
    # vcpkg only reports this recovery path after its own extraction command
    # has failed during the final directory rename. Require an executable in
    # the candidate; the next vcpkg invocation remains the integrity check.
    $RequiredExecutable = Get-ChildItem -LiteralPath $Partial.FullName -Recurse -Filter '*.exe' -File |
      Select-Object -First 1 -ExpandProperty FullName
    if (-not $RequiredExecutable -or -not (Test-Path -LiteralPath $RequiredExecutable)) { continue }
    Move-Item -LiteralPath $Partial.FullName -Destination $FinalPath
    Write-Host "Recovered completed vcpkg tool extraction at $FinalPath."
    $Recovered = $true
  }
  return $Recovered
}

$VcpkgInstallArguments = @(
  'install',
  "--x-manifest-root=$ManifestRoot",
  "--x-install-root=$InstalledRoot",
  "--triplet=$Triplet",
  "--overlay-ports=$OverlayRoot"
)
$InstallExitCode = 1
for ($Attempt = 1; $Attempt -le 5; $Attempt += 1) {
  # The script normally treats any native non-zero exit as terminating. For
  # this one checksum-verified package-manager invocation, collect the exit
  # code so transient download failures can enter the bounded retry below.
  $PreviousNativeErrorPreference = $PSNativeCommandUseErrorActionPreference
  try {
    $PSNativeCommandUseErrorActionPreference = $false
    & $VcpkgToolPath @VcpkgInstallArguments
    $InstallExitCode = $LASTEXITCODE
  } finally {
    $PSNativeCommandUseErrorActionPreference = $PreviousNativeErrorPreference
  }
  if ($InstallExitCode -eq 0) { break }
  if ($Attempt -eq 5) { break }
  if (RepairCompletedVcpkgToolExtractions) {
    Write-Host "Retrying vcpkg media dependency build after tool-cache recovery (attempt $($Attempt + 1) of 5)."
  } else {
    # vcpkg verifies every source archive against the port's SHA512 before
    # extracting it. A retry is therefore safe for transient CDN/TLS failures
    # and reuses each successfully validated archive from downloads/.
    Write-Host "Retrying vcpkg media dependency build after a failed attempt (attempt $($Attempt + 1) of 5)."
    Start-Sleep -Seconds $Attempt
  }
}
if ($InstallExitCode -ne 0) { throw 'vcpkg media dependency build failed.' }

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
