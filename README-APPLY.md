# IntentLock — Frontend Redesign / Pre-V11.5

**Safety boundary:** Overlay touches `apps/web` only. It does not overwrite the backend, database, .dev.vars, credentials, or existing worker tests. Based on the V11.4.1.1-era frontend, including the V11.3 `/new-purchase` PayPal return/resume flow and V11.4 refund UX.

## Use

1. Confirm the existing `D:\IntentLock` working tree is committed or backed up; do not run `git clean`.
2. Extract this archive directly to `D:\IntentLock` with file replacement enabled, **not** to `D:\IntentLock\IntentLock-Frontend-Redesign`.
3. From `D:\IntentLock`, run:

```powershell
npm install
npm test
npm --workspace apps/web run build
cd apps/worker
npx.cmd wrangler deploy --dry-run --outdir .wrangler\frontend-dry-run
```

4. Start web + worker in separate terminals with `npm run dev:web` / `npm run dev:worker`, then inspect all routes.
5. Confirm `.env.local` still points to the intended backend, and do a new PayPal Sandbox end-to-end transaction in a **new** session. Do not refund the previously verified clean capture.
6. Inspect diffs before committing or deploying. This patch is **not deployed** and has **not passed full Next build in this offline authoring container**.

## Included

- New full-width landing page and coherent responsive design system (`#F7F6F2` paper, `#0B1220` ink, `#0A2540` navy, `#1F5FE0` accent).
- Intent Firewall explanation and dynamic scenario switcher, labelled illustrative.
- Interactive Intent Wallet explanatory threshold slider, labelled illustrative.
- Real API DemoRunner: lists the real USD Intent Wallets and PayPal demo connector; optionally creates an explicitly bounded $100 **Sandbox-only** wallet; creates real PurchaseSession and runs real commerce/policy. If selected session is READY_TO_PAY, existing `/new-purchase` handles actual PayPal approval/capture.
- Slim product sidebar, blue/navy shell, removal of numbered/arrows/version labels, responsive updates.
- Live Trust Center and Post-Purchase legacy UI APIs untouched; their CSS updated to improve contrast and type size. Other legacy routes keep all their existing APIs; shared shell unifies their navigation.
- Expired WhatsApp QR is hidden, with Oct 5, 2026 as the default expiration date.
- Geist/Geist Mono font via `next/font`, search metadata, dynamically generated OG image.
- Reusable `DecisionBadge`, `StatusPill`, `MonoField`, `HashChip`, `CodePanel`, `Timeline`, `WalletCard`, `ReceiptCard`, `FirewallDiagram`, `LiveDemoRunner`.
- CSS tokens plus `apps/web/tailwind.config.ts` reference token map. Runtime UI remains compatible with the existing CSS module architecture; **full Tailwind/shadcn/Framer Motion migration is NOT part of this tested-safe overlay**.

## Important real demo constraints

A no-login, one-click real PayPal capture cannot be guaranteed with the existing backend: PayPal requires buyer approval. The landing experience can create sandbox-only wallet authority in one explicit click and run real session policy; then judges continue to the real PayPal approval page. It does **not** fabricate a paid state. For an uninterrupted demonstration use a pre-created, active USD wallet and a valid PayPal sandbox buyer account.

The advertised 215 passing Vitest cases came from user-local V11.4.1.1 validation; the archive does not re-run them. The marketing page labels interactive diagrams as illustrative, actual backend evaluations as real, and proof example as sample schema.

## Visual source limitations

The requested `Main.dc.html`, `Transaction.dc.html`, and mockup screenshots were not present in the received attachments. The shipped visual direction follows the precise color, copy, hierarchy and page-order prose spec, but cannot be claimed pixel-perfect against those missing files.

## Integration follow-up

AG Studio and APIMatic/Render/Bryntum are **not** added in this UI patch. See `SPONSOR-ROADMAP.md` for prioritized, evidence-based add-ons, licensing notes and real workload requirements.
