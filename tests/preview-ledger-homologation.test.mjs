import test from 'node:test';
import assert from 'node:assert/strict';
import { runPreviewLedgerHomologation } from '../lib/preview-ledger-homologation.mjs';

function makeLedger({
  denyReservation = false,
  failCleanup = false,
  failCompletion = false,
} = {}) {
  const budgets = new Map();
  const reservations = new Map();
  const calls = [];

  const db = {
    supabaseUrl: 'https://lftqhpoaydelblobichr.supabase.co',

    from(table) {
      if (table === 'editorial_pilot_budgets') {
        return {
          async insert(row) {
            calls.push('create');
            budgets.set(row.id, { ...row });
            return { error: null };
          },
          select() {
            return {
              eq(_column, id) {
                return Promise.resolve({
                  data: budgets.has(id) ? [{ id }] : [],
                  error: null,
                });
              },
            };
          },
        };
      }

      if (table === 'editorial_pilot_reservations') {
        return {
          select() {
            const filters = {};
            const query = {
              eq(column, value) {
                filters[column] = value;
                return query;
              },
              async single() {
                const reservation = reservations.get(
                  filters.idempotency_key,
                );
                return {
                  data: reservation?.pilot_id === filters.pilot_id
                    ? reservation
                    : null,
                  error: null,
                };
              },
              then(resolve, reject) {
                const rows = [...reservations.values()].filter(
                  row => row.pilot_id === filters.pilot_id,
                );
                return Promise.resolve({
                  data: rows.map(row => ({ id: row.id })),
                  error: null,
                }).then(resolve, reject);
              },
            };
            return query;
          },
        };
      }

      throw new Error('Unexpected table');
    },

    async rpc(name, args) {
      calls.push(name);

      if (name === 'claim_editorial_pilot_mock_run') {
        if (db.claimed) {
          return { data: false, error: null };
        }

        db.claimed = {
          pilotId: args.p_pilot_id,
          idempotencyKey: args.p_idempotency_key,
        };

        return { data: true, error: null };
      }

      if (name === 'reserve_editorial_pilot_request') {
        if (denyReservation) {
          return { data: false, error: null };
        }

        const budget = budgets.get(args.p_pilot_id);

        if (!budget || budget.reserved_requests !== 0) {
          return { data: false, error: null };
        }

        budget.reserved_requests = 1;
        budget.reserved_micro_usd = args.p_reserved_micro_usd;

        reservations.set(args.p_key, {
          id: args.p_key,
          pilot_id: args.p_pilot_id,
          state: 'reserved',
        });

        return { data: true, error: null };
      }

      if (name === 'complete_editorial_pilot_reservation') {
        if (failCompletion) {
          return { data: false, error: null };
        }

        const reservation = reservations.get(args.p_idempotency_key);

        if (!reservation) {
          return { data: false, error: null };
        }

        reservation.state = 'completed';
        reservation.actual_micro_usd = args.p_actual_micro_usd;

        return { data: true, error: null };
      }

      if (name === 'cleanup_editorial_pilot_mock_fixture') {
        if (failCleanup) {
          return { data: false, error: null };
        }

        if (
          db.claimed?.pilotId !== args.p_pilot_id ||
          db.claimed?.idempotencyKey !== args.p_idempotency_key
        ) {
          return { data: false, error: null };
        }

        const reservation = reservations.get(args.p_idempotency_key);

        if (!reservation) {
          // The TEST cleanup RPC requires exactly one completed mock reservation.
          return { data: false, error: null };
        }

        if (
          reservation.pilot_id !== args.p_pilot_id ||
          reservation.state !== 'completed'
        ) {
          return { data: false, error: null };
        }

        reservations.delete(args.p_idempotency_key);
        budgets.delete(args.p_pilot_id);

        return { data: true, error: null };
      }

      throw new Error('Unexpected RPC');
    },
  };

  return { db, budgets, reservations, calls };
}

test('mock completes reservation and cleans only its fixture', async () => {
  const ledger = makeLedger();

  const result = await runPreviewLedgerHomologation(ledger.db);

  assert.equal(result.ok, true);
  assert.equal(result.code, 'LEDGER_MOCK_HOMOLOGATION_PASSED');
  assert.equal(result.reservationConfirmed, true);
  assert.equal(result.completionConfirmed, true);
  assert.equal(result.cleanupConfirmed, true);

  assert.equal(ledger.budgets.size, 0);
  assert.equal(ledger.reservations.size, 0);

  assert.deepEqual(ledger.calls, [
    'claim_editorial_pilot_mock_run',
    'create',
    'reserve_editorial_pilot_request',
    'complete_editorial_pilot_reservation',
    'cleanup_editorial_pilot_mock_fixture',
  ]);
});

test('denied reservation retains empty fixture and claim when cleanup is unconfirmed', async () => {
  const ledger = makeLedger({ denyReservation: true });

  const result = await runPreviewLedgerHomologation(ledger.db);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'EMPTY_FIXTURE_CLEANUP_UNCONFIRMED');
  assert.equal(result.cleanupConfirmed, false);
  assert.equal(ledger.budgets.size, 1);
  assert.ok(ledger.budgets.has(result.fixtureId));
  assert.equal(ledger.reservations.size, 0);
  assert.ok(ledger.db.claimed);

  const repeated = await runPreviewLedgerHomologation(ledger.db);
  assert.equal(repeated.code, 'LEDGER_HOMOLOGATION_ALREADY_CLAIMED');
  assert.equal(ledger.budgets.size, 1);

  assert.deepEqual(ledger.calls, [
    'claim_editorial_pilot_mock_run',
    'create',
    'reserve_editorial_pilot_request',
    'cleanup_editorial_pilot_mock_fixture',
    'claim_editorial_pilot_mock_run',
  ]);
});

test('unconfirmed completion never triggers cleanup', async () => {
  const ledger = makeLedger({ failCompletion: true });

  const result = await runPreviewLedgerHomologation(ledger.db);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'PILOT_COMPLETION_UNCONFIRMED');
  assert.equal(result.cleanupConfirmed, false);

  assert.equal(
    ledger.calls.includes('cleanup_editorial_pilot_mock_fixture'),
    false,
  );
});

test('cleanup failure retains fixture for investigation', async () => {
  const ledger = makeLedger({ failCleanup: true });

  const result = await runPreviewLedgerHomologation(ledger.db);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'FIXTURE_CLEANUP_UNCONFIRMED');
  assert.equal(result.cleanupConfirmed, false);
  assert.equal(ledger.budgets.size, 1);
  assert.equal(ledger.reservations.size, 1);
});

test('mock rejects cleanup with incorrect fixture identity', async () => {
  const ledger = makeLedger();

  ledger.db.claimed = {
    pilotId: 'pilot-approved',
    idempotencyKey: 'key-approved',
  };

  ledger.budgets.set('pilot-approved', {
    id: 'pilot-approved',
    reserved_requests: 0,
    reserved_micro_usd: 0,
  });

  const result = await ledger.db.rpc(
    'cleanup_editorial_pilot_mock_fixture',
    {
      p_pilot_id: 'pilot-approved',
      p_idempotency_key: 'key-wrong',
    },
  );

  assert.equal(result.data, false);
  assert.equal(ledger.budgets.size, 1);
});

test('concurrent executions create only one fixture', async () => {
  const ledger = makeLedger();

  const results = await Promise.all([
    runPreviewLedgerHomologation(ledger.db),
    runPreviewLedgerHomologation(ledger.db),
  ]);

  assert.equal(results.filter(result => result.ok).length, 1);

  assert.equal(
    results.filter(
      result => result.code ===
        'LEDGER_HOMOLOGATION_ALREADY_CLAIMED',
    ).length,
    1,
  );

  assert.equal(
    ledger.calls.filter(name => name === 'create').length,
    1,
  );

  assert.equal(
    ledger.calls.filter(
      name => name === 'reserve_editorial_pilot_request',
    ).length,
    1,
  );

  assert.equal(ledger.budgets.size, 0);
  assert.equal(ledger.reservations.size, 0);
  assert.ok(ledger.db.claimed);
});

test('completed mock cannot acquire a second execution', async () => {
  const ledger = makeLedger();

  const first = await runPreviewLedgerHomologation(ledger.db);
  const second = await runPreviewLedgerHomologation(ledger.db);

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(
    second.code,
    'LEDGER_HOMOLOGATION_ALREADY_CLAIMED',
  );

  assert.equal(
    ledger.calls.filter(name => name === 'create').length,
    1,
  );

  assert.ok(ledger.db.claimed);
});
