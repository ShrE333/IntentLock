# IntentLock

Policy-gated transaction infrastructure for agentic commerce.

**Core rule:** the agent may reason and propose; only the deterministic policy engine may authorize a money action.

## Run
```bash
npm install
npm run dev:worker
```
In another terminal:
```bash
npm run dev:web
```

First milestone: intent -> proposal -> deterministic ALLOW/BLOCK/REQUIRES_APPROVAL.
