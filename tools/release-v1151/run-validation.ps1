# Safe verification of current local IntentLock code. Never deploys, migrates prod, or makes payments.
param(
  [switch]$WithBrowser,
  [switch]$WithPostgres,
  [int]$TestPostgresPort = 5432,
  [switch]$SkipSecondTestRun
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $repo
if (-not (Test-Path 'apps/web/package.json') -or -not (Test-Path 'apps/worker/package.json')) {
  throw "Not in the IntentLock monorepo: $repo"
}
function Invoke-Checked([string] $Description, [string] $Executable, [string[]] $ArgsList) {
  Write-Host "`n==== $Description ====" -ForegroundColor Cyan
  & $Executable @ArgsList
  if ($LASTEXITCODE -ne 0) { throw "$Description failed (exit $LASTEXITCODE)" }
}
Invoke-Checked 'V11.5.1 source/deployment preflight' 'node' @('tools/release-v1151/audit.mjs')
Invoke-Checked 'Worker unit tests' 'npm.cmd' @('test')
if (-not $SkipSecondTestRun) { Invoke-Checked 'Worker unit tests (second run)' 'npm.cmd' @('test') }
Invoke-Checked 'Worker strict TypeScript' 'npm.cmd' @('--workspace','apps/worker','exec','--','tsc','--noEmit','--strict')
# Build-only placeholder if a real API URL was not provided in this terminal.
# This does NOT configure any Vercel/Cloudflare deployment or change .env files.
$hadApiEnv = Test-Path Env:NEXT_PUBLIC_INTENTLOCK_API_URL
if (-not $hadApiEnv) {
  $env:NEXT_PUBLIC_INTENTLOCK_API_URL = 'https://intentlock-api.invalid'
  Write-Host 'Using non-routable API placeholder only for local build validation. Production Vercel needs its real HTTPS Worker URL.' -ForegroundColor Yellow
}
try {
  Invoke-Checked 'Next.js production build' 'npm.cmd' @('--workspace','apps/web','run','build')
  Invoke-Checked 'Frontend strict TypeScript' 'npm.cmd' @('--workspace','apps/web','exec','--','tsc','--noEmit','--strict')
} finally {
  if (-not $hadApiEnv) { Remove-Item Env:NEXT_PUBLIC_INTENTLOCK_API_URL -ErrorAction SilentlyContinue }
}
Push-Location 'apps/worker'
try { Invoke-Checked 'Cloudflare Worker build dry-run' 'npx.cmd' @('wrangler','deploy','--dry-run','--outdir','.wrangler/v1151-dry-run') }
finally { Pop-Location }
if ($WithBrowser) { Invoke-Checked 'Desktop/mobile browser regressions' 'npm.cmd' @('--workspace','apps/web','run','test:browser') }
else { Write-Host 'Browser suite skipped. Use -WithBrowser to include.' -ForegroundColor Yellow }
if ($WithPostgres) {
  if ($TestPostgresPort -lt 1 -or $TestPostgresPort -gt 65535) { throw 'Invalid PostgreSQL port' }
  Write-Host "TEST ONLY: Using disposable local PostgreSQL port $TestPostgresPort" -ForegroundColor Yellow
  Invoke-Checked 'Disposable database/migration checks' 'node' @('apps/worker/scripts/validate-release-postgres.mjs',"$TestPostgresPort")
} else {Write-Host 'PostgreSQL suite skipped. Use -WithPostgres ONLY against an isolated test database.' -ForegroundColor Yellow}
Write-Host "`nAll selected checks passed. No deploy or payment was performed." -ForegroundColor Green
