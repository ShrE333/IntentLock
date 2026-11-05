#requires -Version 5.1
[CmdletBinding()]
param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$tool = Join-Path $PSScriptRoot 'sandbox-tools.mjs'
$wrangler = Join-Path $PSScriptRoot '../../../node_modules/wrangler/bin/wrangler.js'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 and run npm ci first.' }
if (-not (Test-Path -LiteralPath $wrangler)) { throw 'Repository Wrangler is missing. Run npm ci first.' }

function Invoke-Check([string]$Command) {
    $result = & node $tool $Command
    if ($LASTEXITCODE -ne 0) { throw "Sandbox $Command check failed (exit $LASTEXITCODE). See the preceding safe stage/code/status diagnostic; no configuration changed." }
    return $result
}
function Read-Protected([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $secure.Dispose() }
}
function Put-Protected([string]$Name, [string]$Value) {
    # Pipeline stdin, never a process argument or file. Suppress provider output.
    $Value | & node $tool put $Name
    if ($LASTEXITCODE -ne 0) { throw "Failed configuring $Name (exit $LASTEXITCODE). See the preceding safe stage/code/status diagnostic; no values are printed." }
}

Invoke-Check 'config' | Write-Output
$inventory = (Invoke-Check 'secrets') | ConvertFrom-Json
Write-Output 'Required PayPal secret names (presence does not establish validity):'
@('PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYPAL_WEBHOOK_ID','PAYPAL_RETURN_BASE_URL','PAYPAL_ACCOUNT_MERCHANT_ID','PAYPAL_MERCHANT_BINDINGS_JSON') | Write-Output
Write-Output ('Missing names: ' + ($inventory.missing -join ', '))
if ($CheckOnly) { return }

$previousAccount = $env:INTENTLOCK_MAPPING_ACCOUNT_ID
$previousEncoding = $OutputEncoding
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    foreach ($name in $inventory.missing) {
        $value = $null
        if ($name -eq 'PAYPAL_MERCHANT_BINDINGS_JSON') {
            Write-Output 'Use genuine sandbox business account details and existing written authorization. No IDs or approval evidence will be generated.'
            if (-not $env:INTENTLOCK_MAPPING_ACCOUNT_ID) {
                $env:INTENTLOCK_MAPPING_ACCOUNT_ID = Read-Protected 'Actual configured sandbox business merchant ID (hidden)'
            }
            $mapping = [ordered]@{
                mappingId = (Read-Protected 'Your registry mapping ID (hidden)')
                mappingVersion = 1
                environment = 'sandbox'
                connectorId = 'paypal-demo-marketplace'
                catalogProvider = 'paypal-demo'
                catalogSellerId = (Read-Protected 'Authorized catalog seller key, e.g. audiohub-sandbox (hidden)')
                merchantOfRecordId = (Read-Protected 'Genuine authorized merchant-of-record reference (hidden)')
                checkoutMerchantId = (Read-Protected 'Genuine authorized checkout merchant reference (hidden)')
                paypalMerchantId = $env:INTENTLOCK_MAPPING_ACCOUNT_ID
                integration = 'DIRECT_MERCHANT'
                approvalReference = (Read-Protected 'Existing written authorization reference (hidden)')
                validUntil = (Read-Protected 'Authorization expiry as future ISO timestamp (hidden)')
            }
            $value = ConvertTo-Json -InputObject @($mapping) -Depth 4 -Compress
            $mapping = $null
        } else {
            $value = Read-Protected "Sandbox value for $name (hidden)"
            if ($name -eq 'PAYPAL_ACCOUNT_MERCHANT_ID') { $env:INTENTLOCK_MAPPING_ACCOUNT_ID = $value }
        }
        if ([string]::IsNullOrWhiteSpace($value)) { throw "Missing value for $name" }
        Put-Protected $name $value
        $value = $null
    }
} finally {
    $value = $null
    $env:INTENTLOCK_MAPPING_ACCOUNT_ID = $previousAccount
    $OutputEncoding = $previousEncoding
}
Write-Output 'Setup finished. Next run check:paypal, then explicit sandbox OAuth verification. No payment was executed.'
