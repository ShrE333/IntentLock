INTENTLOCK V9 — UNIFIED FRONTEND

This replaces the mixed V8/V9 frontend files with one consistent component
structure and one matching stylesheet.

1. Make a backup:
   cd D:\IntentLock
   Copy-Item apps\web\app apps\web\app_before_unified_fix -Recurse

2. Extract this ZIP directly over:
   D:\IntentLock

   Allow it to replace existing files.

3. Ensure this exists:
   D:\IntentLock\apps\web\.env.local

   Contents:
   NEXT_PUBLIC_INTENTLOCK_API_URL=https://intentlock-worker.shdixit10.workers.dev

4. Stop the currently running Next server with Ctrl+C.

5. Run:
   cd D:\IntentLock
   npm run dev:web

6. Hard refresh browser:
   Ctrl + Shift + R

Pages:
- /
- /new-purchase
- /security-lab
- /evals
- /audit

Do not append old CSS snippets after this replacement.
