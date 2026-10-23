# Run FROM the unpacked patch root; refuses to overwrite any existing project file.
param([Parameter(Mandatory=$true)][string]$RepositoryPath)
$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$destinationRoot = (Resolve-Path $RepositoryPath).Path
if(-not (Test-Path (Join-Path $destinationRoot 'apps/web/package.json'))) {throw "Invalid IntentLock root: $destinationRoot"}
$copy = @(
  'apps/web/app/api/build-info/route.ts',
  'tools/release-v1151/audit.mjs',
  'tools/release-v1151/run-validation.ps1',
  'tools/release-v1151/APPLY.ps1',
  'tools/release-v1151/README.md',
  'docs/V11.5.1-release-verification.md'
)
foreach($rel in $copy) {
  $dst = Join-Path $destinationRoot $rel
  if(Test-Path $dst) {throw "Refusing to overwrite existing file: $dst. Review before applying."}
}
foreach($rel in $copy) {
  $src=Join-Path $sourceRoot $rel
  $dst=Join-Path $destinationRoot $rel
  $dir=Split-Path -Parent $dst
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  Copy-Item -LiteralPath $src -Destination $dst
  Write-Host "Added: $rel" -ForegroundColor Green
}
Write-Host 'Applied additive V11.5.1 kit. No app, config or financial data overwritten.'
