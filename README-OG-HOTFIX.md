# IntentLock frontend Open Graph build hotfix

Based on the Frontend Redesign Pre-V11.5 ZIP. This is a minimal 3-file replacement patch.

## Fixes
- `apps/web/app/opengraph-image.tsx`: render the multi-line headline as flex-column spans instead of a multi-child div containing a `<br/>`. Next.js `next/og` (Satori) requires an explicit flex/none display for a div with multiple children. The headline text is unchanged.
- `apps/web/app/intentlock-design.css`: `align-items:end` -> `align-items:flex-end`
- `apps/web/app/trust-center/trust-center.module.css`: `align-items:end` -> `align-items:flex-end`

## Apply
Extract the ZIP to `D:\IntentLock`, allowing replacement of these three files. Do not remove other project files.

## Verify in PowerShell
```powershell
cd D:\IntentLock
npm --workspace apps/web run build
npm test
```

The Worker deployment dry-run already passed according to the user's supplied log. This patch does not touch Worker code, secrets, migrations, or payment behavior.

This patch was checked against the source archive for exact string matches; full `next build` should run in the user's configured Windows environment.
