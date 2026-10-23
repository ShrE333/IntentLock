INTENTLOCK V10.8.1 — WHATSAPP SAFETY HOTFIX
===========================================

WHY THIS EXISTS
===============

V10.8 had a subtle ordering bug:

1. An unauthorized chat sent INTENTLOCK <PAIR_CODE>.
2. IntentLock paired the chat.
3. Only normal authorized messages were deduplicated later.
4. If WAHA redelivered the same pairing event, the chat was now authorized.
5. The repeated INTENTLOCK <PAIR_CODE> text could fall through to the
   natural-language BUY parser.

WAHA/NOWEB can also replay older unread messages after a reconnect/restart.

V10.8.1 fixes both.


FIXES
=====

- Pairing message is deduplicated BEFORE pairing.
- Every authorized message is deduplicated BEFORE command handling.
- Repeated pairing commands can never become BUY requests.
- Historical messages older than 5 minutes are ignored.
- Random unpaired chats remain completely silent.
- No new DB migration is needed.


APPLY
=====

Extract over:

D:\IntentLock

Then:

cd D:\IntentLock
node .\apply-v10-8-1.mjs
npm test

If tests pass:

cd D:\IntentLock\apps\worker
npx wrangler deploy

Verify:

Invoke-RestMethod "https://intentlock-worker.shdixit10.workers.dev/health" | ConvertTo-Json

Expected:
version = v10.8.1


IMPORTANT: ROTATE THE PAIRING CODE
==================================

The previous pairing code appeared in screenshots/chat, so generate a fresh one:

$PAIR_CODE = [guid]::NewGuid().ToString("N").Substring(0,16)
Write-Host $PAIR_CODE

Then:

cd D:\IntentLock\apps\worker
npx wrangler secret put WAHA_PAIRING_CODE

Paste the NEW value.

Deploy again:

npx wrangler deploy

Do not post the new pairing code publicly.


CLEAN TEST
==========

Keep WAHA WORKING.

1. Start Worker tail:

cd D:\IntentLock\apps\worker
npx wrangler tail intentlock-worker --format pretty

2. Random/unpaired person sends:

hello

Expected:
NO WHATSAPP RESPONSE.

3. Approved tester sends:

INTENTLOCK <NEW_PAIR_CODE>

Expected exactly once:

IntentLock access enabled

4. Then approved tester sends:

HELP

Expected:
IntentLock HELP response.

5. Send HELP again.

Expected:
normal HELP response again.

6. Approved tester sends:

INTENTLOCK <NEW_PAIR_CODE>

Expected:
"This chat is already paired..."
It must NOT start a purchase.

7. To revoke:

INTENTLOCK STOP

After that:
HELP should receive NO response.


ABOUT MANY WRANGLER POST LINES
==============================

Wrangler tail logs every request to /webhooks/waha, including events that the
Worker immediately ignores.

The security requirement is not "exactly one POST in tail".
The requirement is:

- only event=message is processed
- fromMe messages are ignored
- stale backlog is ignored
- unauthorized chats are ignored
- duplicate message IDs are ignored
- only paired chats reach the command/purchase service
