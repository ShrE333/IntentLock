INTENTLOCK V9 FIXED APPLIER

Your V9 source files were already extracted from the previous patch.
The old apply-v9.ps1 had a PowerShell parser error.

Copy/overwrite this new apply-v9.ps1 into:

D:\IntentLock\apply-v9.ps1

Then run:

cd D:\IntentLock
powershell -ExecutionPolicy Bypass -File .\apply-v9.ps1
npm test
