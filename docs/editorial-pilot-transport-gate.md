# Pilot transport budget gate — design, NOT activated

Status: SPECIFICATION ONLY. Do not enable paid A/B inference.

## Preflight invariants

1. Only isolated Supabase TEST (lftqhpoaydelblobichr), draft PR Preview and explicitly approved pilot IDs.
2. USD 5 is a planning cap, not proof of precise downstream billing. No paid requests until an operator separately approves running.
3. The API transport MUST reject missing or inaccurate input-token ceilings, output ceilings, pricing, model mapping, project identity, and ledger availability.
4. Reserve in one atomic, database-side transaction **before** each outgoing API call; no in-memory Vercel counter.
5. Acquire reservations across all serverless instances with row-level locking on one pilot budget row. Count reserved plus completed calls toward the max of 20.
6. For each request, charge against remaining budget a conservative USD upper bound incorporating input, output, tool calls and any priced reasoning/tool usage. When an upper bound cannot be established, reject. Use integer micro-USD (or finer) units; avoid floating-point billing decisions.
7. Record one immutable unique idempotency key per intended request and stage. Never regenerate/retry an ambiguous request automatically.
8. After a response, record provider usage; never free reservation solely on client timeout/network error because the provider may have processed it. Keep ambiguous reservations held pending reconciliation.
9. All requests in a batch should stop on a failed reservation, on missing credits, on invalid source evidence or on unsupported factual claims. No automatic approval/publishing.
10. Each arm: five paired news, zero repairs, one drafting and one verification request per news; exactly 20 requests maximum for both arms.

## Suggested persisted resources (migration not yet applied)

- `editorial_pilot_budgets`: pilot UUID, ceiling_micro_usd, reserved_micro_usd, spent_micro_usd, max_requests, reserved_requests, state, created_at.
- `editorial_pilot_reservations`: UUID, pilot UUID, request idempotency key unique, news ID, arm, stage, model, max-input, max-output, estimated worst-case micro USD, actual reported tokens/cost, state (reserved/completed/uncertain/rejected), timestamps.
- An authenticated service-role-only PostgreSQL RPC performs conditional reserve atomically, with row lock and row count/amount assertions. Never expose via public client or to production keys.
- RLS restricts all tables. Logging excludes prompts, captured sources, draft articles, tokens/keys from headers and payment details.

## Verification required before rollout

- Independent simultaneous reservation concurrency test proving at most 20 reservations and at most 5 USD (conservative bound).
- Fail-closed tests for wrong project, missing ledger, missing price, unknown model or tool, ambiguous timeouts, duplicate idempotency keys, insufficient budget, and recovery.
- Update `createOpenAIResponse` call site only with a separately activated pilot transport; never alter non-pilot editorial workflows as a side effect.
- End-to-end test in Preview TEST using mocked HTTP response and real TEST ledger, **without paid OpenAI calls**.
- Separately authorize replenishing credits and making any paid requests.

## Current evidence

Read-only check of PUBLIC tables in TEST Supabase on October 9, 2026 found no table whose name includes budget/usage/pilot/ledger. No schema migration or write has been run.

The existing `lib/editorial-pilot-budget.mjs` is offline estimation only and returns executionEnabled=false. This document must not be interpreted as a deployed spending cap.
