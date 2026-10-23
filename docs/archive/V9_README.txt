INTENTLOCK V9 READY PATCH

1. Extract this ZIP directly over D:\IntentLock
2. Open PowerShell:
   cd D:\IntentLock
   powershell -ExecutionPolicy Bypass -File .\apply-v9.ps1
3. Run:
   npm test
4. Start backend locally:
   npm run dev:worker
5. In another PowerShell:
   Invoke-RestMethod http://localhost:8787/api/evals | ConvertTo-Json -Depth 10
6. Start frontend:
   npm run dev:web
7. Open:
   http://localhost:3000/evals

Only deploy after the local endpoint works:
   cd D:\IntentLock\apps\worker
   npx wrangler deploy
