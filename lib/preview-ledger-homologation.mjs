import { randomUUID } from 'node:crypto';
import { simulateReservedEditorialRequest } from './editorial-pilot-transport.mjs';

export async function runPreviewLedgerHomologation(supabase) {
  const pilotId = randomUUID();
  const idempotencyKey = randomUUID();

  const fixture = {
    id: pilotId,
    ceiling_micro_usd: 100,
    reserved_micro_usd: 0,
    max_requests: 1,
    reserved_requests: 0,
    state: 'enabled',
  };

  let inserted = false;

  try {
    const claim = await supabase.rpc(
      'claim_editorial_pilot_mock_run',
      {
        p_pilot_id: pilotId,
        p_idempotency_key: idempotencyKey,
      },
    );

    if (claim.error) {
      return {
        ok: false,
        code: 'LEDGER_HOMOLOGATION_CLAIM_UNCONFIRMED',
        cleanupConfirmed: false,
      };
    }

    if (claim.data !== true) {
      return {
        ok: false,
        code: 'LEDGER_HOMOLOGATION_ALREADY_CLAIMED',
        cleanupConfirmed: false,
      };
    }

    const creation = await supabase
      .from('editorial_pilot_budgets')
      .insert(fixture);

    if (creation.error) {
      return { ok: false, code: 'FIXTURE_CREATION_FAILED' };
    }

    inserted = true;

    const result = await simulateReservedEditorialRequest({
      supabase,
      reservation: {
        pilotId,
        idempotencyKey,
        newsId: 6,
        arm: 'luna',
        stage: 'site-editorial',
        model: 'ledger-homologation-mock-v1',
        maxInputTokens: 1000,
        maxOutputTokens: 1000,
        reserveMicroUsd: 100,
      },
      mockSend: async () => ({
        usage: {
          input_tokens: 2,
          output_tokens: 3,
        },
        actual_micro_usd: 20,
      }),
      pilotExecutionEnabled: false,
    });

    if (!result.success) {
      if (result.code === 'PILOT_RESERVATION_DENIED') {
        try {
          const cleanup = await supabase.rpc(
            'cleanup_editorial_pilot_mock_fixture',
            {
              p_pilot_id: pilotId,
              p_idempotency_key: idempotencyKey,
            },
          );

          if (cleanup.error || cleanup.data !== true) {
            return {
              ok: false,
              code: 'EMPTY_FIXTURE_CLEANUP_UNCONFIRMED',
              fixtureId: pilotId,
              cleanupConfirmed: false,
            };
          }

          const budgetCheck = await supabase
            .from('editorial_pilot_budgets')
            .select('id')
            .eq('id', pilotId);

          if (
            budgetCheck.error ||
            budgetCheck.data?.length !== 0
          ) {
            return {
              ok: false,
              code: 'EMPTY_FIXTURE_REMOVAL_UNVERIFIED',
              fixtureId: pilotId,
              cleanupConfirmed: false,
            };
          }

          return {
            ok: false,
            code: result.code,
            fixtureId: pilotId,
            cleanupConfirmed: true,
          };
        } catch {
          return {
            ok: false,
            code: 'EMPTY_FIXTURE_CLEANUP_UNCERTAIN',
            fixtureId: pilotId,
            cleanupConfirmed: false,
          };
        }
      }

      return {
        ok: false,
        code: result.code,
        fixtureId: pilotId,
        cleanupConfirmed: false,
      };
    }

    const completion = await supabase
      .from('editorial_pilot_reservations')
      .select('state,actual_micro_usd')
      .eq('pilot_id', pilotId)
      .eq('idempotency_key', idempotencyKey)
      .single();

    if (
      completion.error ||
      completion.data?.state !== 'completed' ||
      completion.data?.actual_micro_usd !== 20
    ) {
      return {
        ok: false,
        code: 'LEDGER_COMPLETION_UNVERIFIED',
        fixtureId: pilotId,
        cleanupConfirmed: false,
      };
    }

    const cleanup = await supabase.rpc(
      'cleanup_editorial_pilot_mock_fixture',
      {
        p_pilot_id: pilotId,
        p_idempotency_key: idempotencyKey,
      },
    );

    if (cleanup.error || cleanup.data !== true) {
      return {
        ok: false,
        code: 'FIXTURE_CLEANUP_UNCONFIRMED',
        fixtureId: pilotId,
        cleanupConfirmed: false,
      };
    }

    const [budgetCheck, reservationCheck] = await Promise.all([
      supabase
        .from('editorial_pilot_budgets')
        .select('id')
        .eq('id', pilotId),
      supabase
        .from('editorial_pilot_reservations')
        .select('id')
        .eq('pilot_id', pilotId),
    ]);

    if (
      budgetCheck.error ||
      reservationCheck.error ||
      budgetCheck.data?.length !== 0 ||
      reservationCheck.data?.length !== 0
    ) {
      return {
        ok: false,
        code: 'FIXTURE_REMOVAL_UNVERIFIED',
        fixtureId: pilotId,
        cleanupConfirmed: false,
      };
    }

    return {
      ok: true,
      code: 'LEDGER_MOCK_HOMOLOGATION_PASSED',
      fixtureId: pilotId,
      reservationConfirmed: true,
      completionConfirmed: true,
      cleanupConfirmed: true,
    };
  } catch {
    return {
      ok: false,
      code: 'LEDGER_MOCK_HOMOLOGATION_UNCERTAIN',
      fixtureId: inserted ? pilotId : undefined,
      cleanupConfirmed: false,
    };
  }
}
