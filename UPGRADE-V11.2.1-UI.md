# Upgrade to IntentLock V11.2.1 Unified UI

Apply this patch **after V11.2 TrustOps**.

## 1. Extract
Extract the ZIP directly into your existing repository root:

```text
D:\IntentLock
```

Choose **Replace files in destination**.

## 2. No database migration
This patch is frontend-only. Do not run any SQL migration.

## 3. Start the app
Terminal 1:

```powershell
cd D:\IntentLock
npm run dev:worker
```

Terminal 2:

```powershell
cd D:\IntentLock
npm run dev:web
```

Open:

```text
http://localhost:3000
http://localhost:3000/trust-center
```

## 4. What to visually verify
The Overview and Trust Center should now clearly belong to the same product:

- warm ivory application background
- forest-green financial/security accents
- same sidebar and route header
- same border radii, typography scale and card treatment
- Trust Center is no longer a full black/dark page
- landing hero is materially different from V11.2 and contains the five-stage control-path visual
- Trust Center keeps a dark green financial-truth visual only as an intentional accent

## 5. Regression tests
Because this patch does not touch the Worker/backend, your existing V11.2 tests should remain unchanged.

Run from the repository root:

```powershell
npm test
```

Then optionally verify the web build:

```powershell
npm --workspace apps/web run build
```

If your web workspace does not have a `build` script, simply run `npm run dev:web` and inspect the two routes above.
