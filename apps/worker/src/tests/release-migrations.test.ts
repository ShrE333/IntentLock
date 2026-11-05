import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {isolatedDatabase} from './isolated-database';

describe('complete release schema', () => {
  it('initializes every ordered migration in a disposable database', async () => {
    const db = await isolatedDatabase();
    try {
      const order: string[] = JSON.parse(readFileSync(new URL('../../db/release-order.json', import.meta.url), 'utf8'));
      for (const file of order) {
        const sql = readFileSync(new URL('../../db/' + file, import.meta.url), 'utf8');
        await db.exec(sql);
      }
      const {rows} = await db.query<{wallet: string; drafts: string; reservations: string}>(
        "SELECT to_regclass('intent_wallets')::text AS wallet, to_regclass('wallet_authority_drafts')::text AS drafts, to_regclass('wallet_authority_reservations')::text AS reservations");
      expect(rows[0].wallet).toBe('intent_wallets');
      expect(rows[0].drafts).toBe('wallet_authority_drafts');
      expect(rows[0].reservations).toBeTruthy();
      expect(order).toHaveLength(19);
    } finally { await db.close(); }
  }, 30000);
});
