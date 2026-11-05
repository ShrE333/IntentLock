# Security status — 2026-11-05

Financial routes use deny-by-default rules, identity scopes and wallet ownership
or grants. Human confirmations bind an exact policy/quote and cannot be supplied
by merchant text or a model. Queue and WhatsApp paths must preserve those checks.
Verified provider events, SQL reservations and ledger uniqueness govern settlement.
Uncertain captures and refunds remain pending, preserving their reservations.

This change validates payment return origins, adds non-secret configuration
diagnostics and bounds public build metadata. Config diagnostics do not perform
credential or connectivity checks. Merchant bindings remain mandatory.

Dependency audit initially reported 21 vulnerabilities: 2 critical, 13 high,
6 moderate. Compatible updates include Next 15.5.29, Zod 4.6.7, Vitest 4.1.12
and Wrangler 4.157.0. Root overrides pin MCP SDK 1.32.2 and PostCSS 8.5.32,
avoiding an unreviewed Agents/Next major upgrade. Hono Node adapter is pinned
to 1.19.18, which fixes high findings but retains a moderate repeated-decoding
static-path middleware advisory (GHSA-rmxm-3fg6-px4f). Its dependency chain also
marks MCP SDK, Agents and ai-chat affected. A v2 adapter migration remains open.
Do not interpret absence of a known reachable static-serving path as a fix.

Production release requires reviewing that advisory, running the final audited
dependency tree through CI and testing actual provider/queue behavior. Scope here
is regression hardening, not a completed independent penetration test or compliance
certification. Enterprise SSO, passkeys, recurring mandates and organization
approvals are not implemented security guarantees.

Use exact CORS origin allowlists, independent operator/admin secrets, isolated
sandbox accounts and least-privilege database/provider access. Do not collect
secrets in diagnostic responses or publish synthetic test merchant identities as
real onboarding. Existing untracked deployment/database helper files were preserved
and are excluded from this change's release artifact.
