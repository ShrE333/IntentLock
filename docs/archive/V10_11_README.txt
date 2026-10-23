INTENTLOCK V10.11 — MINIMAL PRODUCT UI
======================================

DESIGN DIRECTION
================

This version intentionally removes the neon / sci-fi / cartoon aesthetic.

Visual language:

- warm off-white background
- near-black typography
- muted green for WhatsApp/live/approved states
- restrained steel-blue accent
- fine borders
- soft natural shadows
- subtle 3D layering only in the hero
- long scrollable narrative
- no information wall
- no glowing cards
- no gaming-dashboard treatment


INFORMATION ARCHITECTURE
========================

Overview
  Main pitch
  WhatsApp QR
  Problem
  Architecture
  Intent Wallet
  Adaptive Trust
  Tech stack

WhatsApp Demo
  Large QR
  Pre-filled pairing flow
  All WhatsApp commands
  Two-minute judge demo story
  Temporary demo availability notice

New Purchase
  Existing live purchase UI

Intent Wallets
  Existing wallet management UI

Trust & Risk
  V10.9 explanation
  deterministic signals
  real PurchaseSession risk lookup

Security Lab
  Existing prompt-injection / stale quote / duplicate payment demos

Evaluation Suite
  Existing 200-scenario evaluation results

Audit Log
  Existing audit explorer

How it works
  detailed 9-stage architecture
  security invariants
  tech stack
  build history


WHATSAPP QR
===========

The QR is generated in the browser.

It opens:

https://wa.me/<YOUR_NUMBER>?text=INTENTLOCK%20<PAIR_CODE>

So a judge:

1. scans QR
2. WhatsApp opens
3. pairing message is already filled
4. taps Send
5. sends HELP
6. starts using IntentLock

No QR image file is needed.


ENVIRONMENT VARIABLES
=====================

In apps/web/.env.local:

NEXT_PUBLIC_INTENTLOCK_API_URL=https://intentlock-worker.shdixit10.workers.dev

NEXT_PUBLIC_INTENTLOCK_WHATSAPP_NUMBER=91XXXXXXXXXX

NEXT_PUBLIC_INTENTLOCK_PAIRING_CODE=YOUR_DEMO_PAIRING_CODE

NEXT_PUBLIC_INTENTLOCK_DEMO_END_DATE=2026-10-05


IMPORTANT SECURITY NOTE
=======================

NEXT_PUBLIC_* values are public browser configuration.

Therefore the QR pairing code is intentionally a PUBLIC DEMO pairing
credential.

Do NOT reuse a production access secret.

For the month-long judge demo:

- use a dedicated demo pairing code
- keep Razorpay in Test Mode
- rate-limit abuse
- keep WhatsApp authorized-chat controls
- rotate/disable the demo pairing code after 05 Oct 2026


INSTALL
=======

Extract over:

D:\IntentLock

Then:

cd D:\IntentLock
node .\apply-v10-11.mjs

Install QR dependency:

npm install

Create/update:

D:\IntentLock\apps\web\.env.local

Then build:

npm --workspace apps/web run build

Run locally:

npm --workspace apps/web run dev


DEPLOY
======

Deploy the web app to Vercel using the same intentlock-web project.

Because NEXT_PUBLIC_* variables are compiled into the frontend, also add
these values in Vercel Project Settings -> Environment Variables before
deploying:

NEXT_PUBLIC_INTENTLOCK_API_URL
NEXT_PUBLIC_INTENTLOCK_WHATSAPP_NUMBER
NEXT_PUBLIC_INTENTLOCK_PAIRING_CODE
NEXT_PUBLIC_INTENTLOCK_DEMO_END_DATE


WHATSAPP DEMO COMMANDS SHOWN IN UI
==================================

HELP
WALLETS
USE 1
WALLET
Find Sony or Bose wireless ANC headphones under 7000 buy automatically if allowed
ALLOW ONCE
REJECT
STATUS
RESET
INTENTLOCK STOP


V10.11 DOES NOT CHANGE
======================

- Cloudflare Worker backend
- Cloudflare Queue
- Neon schema
- Shopify connector
- Razorpay integration
- WAHA / GOWS configuration
- Intent Wallet policy
- V10.9 Trust & Risk engine

This is a frontend-focused release.
