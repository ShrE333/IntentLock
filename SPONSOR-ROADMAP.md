# IntentLock sponsor-track architecture proposal (not implemented in this archive)

Official hackathon deadline: November 12, 2026 at noon Pacific, per Devpost official rules.

## AG Grid / AG Studio — highest-value enhancement

Feature: **Control Studio**, a real operator-facing analytics and incident-workbench surface powered by AG Studio, not just plain AG Grid rows.

Sources: https://paypalaihackathon.devpost.com/details/aggrid ; https://www.ag-grid.com/studio/react/quick-start/ ; https://www.ag-grid.com/studio/react/ai-agents/ . Devpost says sponsor judging values custom widgets, themes, layout tools and Studio Agent Framework. A 45-day free trial is advertised for hackathon.

Input: purpose-built redacted, read-only summary API, not raw PayPal IDs or access tokens:

- `/api/control-studio/summary?window=24h|7d|30d` — captured, blocked, stepped up, pending, unknown, unhealthy sessions; real counts.
- `/api/control-studio/transactions` — session/decision/provider/currency/amount/status/timestamps + redacted identifiers.
- `/api/control-studio/anomalies` — mismatch, stale capture, missing ledger/proof, suspicious refund spikes.

Widgets: 1) state convergence; 2) wallet budget exposure; 3) transaction outcome/time distributions; 4) refund/dispute risk; 5) drill-down to `/trust-center?sessionId=...` with evidence. AI can build a view from natural language, **never mutate authority, payment, refund or TrustOps state**. The AG Studio dataset must be server-redacted and operator access-controlled, not exposed publicly.

## APIMatic — straightforward developer prize track

Feature: Publish `openapi/intentlock-v1.yaml` covering `/v1/authorize`, wallets, read-only sessions/proofs, status models and typed errors. Use APIMatic Context Plugin for PayPal *as an actual documented tool during implementation* and generate an external SDK + interactive developer portal from the same contract. This is not a claim that merely shipping a YAML file qualifies.

Sources: https://paypalaihackathon.devpost.com/details/apimatic ; https://paypalaihackathon.devpost.com/resources . Demo: external agent calls `/v1/authorize`, receives bounded `INTENTLOCK_AUTH_V1`, rejects stale/overspend proposals. Show generated docs and client usage. Leave admin/refund write APIs private.

## Render — meaningful background workload, not duplicate hosting

Feature: **Reconciliation Sentry** on Render Workflows or background worker. Scheduled checks ask IntentLock for read-only session/provider health, emit sanitized drift findings and open operator review tasks. A Cloudflare-protected/permission-scoped API mediates provider checks; keep PayPal secrets only in the existing Cloudflare Worker. No money mutations from Render.

Source: https://paypalaihackathon.devpost.com/details/render . Sponsor explicitly emphasizes deploying on Render and Render Workflows for agents/background coordination; moving an irrelevant static site merely to win a prize is weak.

## Bryntum — potential, but optional

Feature: **Authority & Dispute Deadline Planner** using Bryntum Calendar/Scheduler/Gantt. Rows are refund windows, dispute response deadlines, wallet expiry, merchant review SLAs and reconciliation backlog. Allow operator notes/tasks, not arbitrary editing of immutable payment history.

Source: https://paypalaihackathon.devpost.com/details/bryntum . Sponsor seeks purposeful scheduling, dependency timelines and resource allocations. This is attractive only once real deadlines exist and are read from providers; placeholder calendars add little.

## Winner strategy

Strongest combined narrative: PayPal + AI + AG Studio. Add APIMatic if time permits and you actually use its tools; Render only with a real background service; Bryntum only for a serious operator deadline/response workflow. Devpost limits a project to at most one sponsor prize plus a grand or honorable mention prize; adding four sponsors does **not** mean collecting all four sponsor prizes.

## Critical demo and security caveats

A real PayPal buyer must approve a sandbox transaction; don't promise all the way to verified capture in under 30 seconds without confirming the buyer account and deployed webhook timing. Both browser and worker should label live/demo data. Frontend admin secret input should never be persisted or shared with analytics; no admin token in `NEXT_PUBLIC_*`. Financially meaningful controls must be enforced server-side. Avoid exposing real customer data when building public dashboards.
