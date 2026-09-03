$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "Applying IntentLock V9..." -ForegroundColor Cyan
Write-Host "Repository: $root"
Write-Host ""

# ------------------------------------------------------------------
# Verify that the V9 files extracted from the previous ZIP are present
# ------------------------------------------------------------------

$requiredFiles = @(
    "apps\worker\src\evals\scenarios.ts",
    "apps\worker\src\evals\run.ts",
    "apps\worker\src\tests\evals.test.ts",
    "apps\web\app\evals\page.tsx"
)

foreach ($relative in $requiredFiles) {
    $full = Join-Path $root $relative
    if (-not (Test-Path $full)) {
        throw "Missing V9 file: $full. Re-extract the V9 patch over D:\IntentLock first."
    }
}

Write-Host "[OK] V9 source files found." -ForegroundColor Green

# ------------------------------------------------------------------
# Patch Worker index.ts
# ------------------------------------------------------------------

$indexPath = Join-Path $root "apps\worker\src\index.ts"

if (-not (Test-Path $indexPath)) {
    throw "Worker index.ts not found: $indexPath"
}

$index = Get-Content $indexPath -Raw

$evalImport = 'import { runFullEvalSuite } from "./evals/run";'

if (-not $index.Contains($evalImport)) {
    $index = $evalImport + "`r`n" + $index
    Write-Host "[OK] Added runFullEvalSuite import." -ForegroundColor Green
}
else {
    Write-Host "[OK] Eval import already present." -ForegroundColor Green
}

$routeSignature = 'url.pathname === "/api/evals"'

if (-not $index.Contains($routeSignature)) {

    $needle = 'const url = new URL(request.url);'

    if (-not $index.Contains($needle)) {
        throw 'Could not find: const url = new URL(request.url); in apps\worker\src\index.ts'
    }

    $route = @'

    if (
      request.method === "GET" &&
      url.pathname === "/api/evals"
    ) {
      try {
        const result = await runFullEvalSuite();

        return json(result);
      } catch (error) {
        return json(
          {
            error: "EVAL_SUITE_FAILED",
            message:
              error instanceof Error
                ? error.message
                : String(error)
          },
          500
        );
      }
    }
'@

    $replacement = $needle + "`r`n" + $route
    $index = $index.Replace($needle, $replacement)

    Write-Host "[OK] Added GET /api/evals." -ForegroundColor Green
}
else {
    Write-Host "[OK] /api/evals route already present." -ForegroundColor Green
}

# Update health version without regex.
$versions = @("v1","v2","v3","v4","v5","v6","v7","v8")

foreach ($version in $versions) {
    $index = $index.Replace('version: "' + $version + '"', 'version: "v9"')
    $index = $index.Replace("version: '" + $version + "'", 'version: "v9"')
}

Set-Content -Path $indexPath -Value $index -Encoding UTF8

Write-Host "[OK] Worker index.ts patched." -ForegroundColor Green

# ------------------------------------------------------------------
# Patch frontend navigation
# ------------------------------------------------------------------

$shellPath = Join-Path $root "apps\web\app\components\Shell.tsx"

if (-not (Test-Path $shellPath)) {
    throw "Shell.tsx not found: $shellPath"
}

$shell = Get-Content $shellPath -Raw

if (-not $shell.Contains('href: "/evals"')) {

    $securityItem = '{ href: "/security-lab", label: "Security Lab", icon: "⚠" },'
    $auditItem = '{ href: "/audit", label: "Audit Log", icon: "▤" },'
    $evalItem = '{ href: "/evals", label: "Evaluations", icon: "▦" },'

    if ($shell.Contains($securityItem)) {
        $shell = $shell.Replace(
            $securityItem,
            $securityItem + "`r`n  " + $evalItem
        )
    }
    elseif ($shell.Contains($auditItem)) {
        $shell = $shell.Replace(
            $auditItem,
            $evalItem + "`r`n  " + $auditItem
        )
    }
    else {
        throw "Could not find Security Lab or Audit Log navigation entry in Shell.tsx."
    }

    Set-Content -Path $shellPath -Value $shell -Encoding UTF8

    Write-Host "[OK] Added Evaluations to sidebar." -ForegroundColor Green
}
else {
    Write-Host "[OK] Evaluations sidebar entry already present." -ForegroundColor Green
}

# ------------------------------------------------------------------
# Add CSS if it was not already added manually
# ------------------------------------------------------------------

$cssPath = Join-Path $root "apps\web\app\globals.css"

if (-not (Test-Path $cssPath)) {
    throw "globals.css not found: $cssPath"
}

$css = Get-Content $cssPath -Raw

if (-not $css.Contains(".evalTable")) {

    $cssBlock = @'

/* === IntentLock V9 Evaluation Dashboard === */

.evalTable {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 11px;
}

.evalRow {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 100px 100px 130px;
  gap: 14px;
  padding: 13px 14px;
  align-items: center;
  border-bottom: 1px solid #eeeef3;
  font-size: 12px;
}

.evalHead {
  background: #f8f8fc;
  color: var(--muted);
  font-weight: 750;
}

.evalHero {
  margin-top: 18px;
  text-align: center;
  padding: 42px 20px;
  background:
    radial-gradient(circle at center, rgba(94,63,225,.10), transparent 45%),
    white;
}

.evalHero h2 {
  margin: 8px 0 0;
  font-size: 72px;
  line-height: 1;
  color: var(--green);
}

.evalHero > div > strong {
  display: block;
  margin-top: 8px;
  font-size: 18px;
}

.evalHero p {
  max-width: 520px;
  margin: 10px auto 0;
  color: var(--muted);
  line-height: 1.6;
  font-size: 12px;
}

@media (max-width: 760px) {
  .evalRow {
    grid-template-columns: 1fr 70px 70px;
  }

  .evalRow > span:last-child {
    display: none;
  }
}

/* === End IntentLock V9 Evaluation Dashboard === */
'@

    Add-Content -Path $cssPath -Value $cssBlock -Encoding UTF8
    Write-Host "[OK] Added V9 CSS." -ForegroundColor Green
}
else {
    Write-Host "[OK] V9 CSS already present. Nothing duplicated." -ForegroundColor Green
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " IntentLock V9 patch applied successfully" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next:"
Write-Host "  cd D:\IntentLock"
Write-Host "  npm test"
Write-Host ""
