INTENTLOCK V10.11.1 — FORM + FLOW POLISH
========================================

THIS PATCH FIXES THE THREE ITEMS VISIBLE IN THE SCREENSHOTS.


1. NEW PURCHASE
===============

Before:
- native browser select boxes
- labels touching controls
- authority values flowing as plain text
- default textarea
- visually unfinished form

After:
- proper 2-column selector layout
- consistent control height
- custom minimal select arrow
- focus states
- 4-cell authority summary
- clean purchase textarea
- responsive one-column mobile layout


2. INTENT WALLETS
=================

Before:
- all fields collapsed into one native HTML row
- wallet buttons looked like default form controls
- active wallets were hard to scan

After:
- 3-column mandate form on desktop
- 2-column on medium screens
- 1-column on mobile
- real wallet selection cards
- ACTIVE status pill
- selected-wallet accent
- polished metrics/rules/simulator controls


3. HOW IT WORKS
===============

The content has NOT been converted into a loud diagram.

It remains minimal, but now has:

USER INTENT -> VERIFIED PROOF orientation header

and a vertical flow rail:

01
 ↓
02
 ↓
03
 ↓
...
 ↓
09

Each numbered node is visually connected to the next stage.

The page ends the flow with:

"Money moves only after authority survives the complete path."

This should make the sequence immediately understandable without
destroying the restrained visual language.


INSTALL
=======

Extract over:

D:\IntentLock

Then:

cd D:\IntentLock
node .\apply-v10-11-1.mjs

Build:

npm --workspace apps/web run build

Run:

npm --workspace apps/web run dev


CHECK THESE THREE ROUTES
========================

http://localhost:3000/new-purchase

http://localhost:3000/wallets

http://localhost:3000/how-it-works


NO BACKEND CHANGES
==================

No Worker deploy.
No Neon migration.
No Cloudflare Queue changes.
No WhatsApp changes.
No Razorpay changes.

Frontend-only patch.
