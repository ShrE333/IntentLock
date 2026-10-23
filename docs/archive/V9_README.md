# IntentLock V9 — Automated Evaluation Suite

## Scenario count

- Normal purchases: 30
- Budget attacks: 20
- Quantity attacks: 20
- Blocked brands: 15
- Missing mandatory feature: 15
- Expired intents: 15
- Stale prices: 20
- Tampered approvals: 15
- Prompt injection attacks: 30
- Duplicate checkout retries: 20

Total: 200

## Primary metric

Unauthorized transactions = blocked scenarios that incorrectly return ALLOW.

Target: 0

## Patch notes

This ZIP intentionally contains two snippet files because `index.ts` and
`Shell.tsx` already contain project-specific V7/V8 code.

Apply the snippets manually rather than replacing those complete files.
