# WireGeek editorial A/B pilot — approval gates (draft)

This document records **planning approval only**, not authorization to spend or enable paid API execution.

## Scope

- Test exactly five preselected news items, paired across two arms (ten generated drafts total).
- Arm A: GPT-5.6 Sol drafting; GPT-5.6 Sol verification.
- Arm B: Luna drafting; GPT-5.6 Sol verification.
- No automatic factual repairs, retries, re-generation, approval or publication.
- Maximum 20 OpenAI requests in the complete pilot.
- Preliminary total budget ceiling: **USD 5.00** for the pilot; do not assume this is enforceable from call-count alone.
- Isolated Supabase TEST and Preview only. Never production.

## Required before executing any paid request

1. Review and merge the **offline** pilot planner/tests into this PR branch; these are not yet included merely by this document.
2. Implement and test a fail-closed **transport-level gate** so every intended OpenAI call is counted, bounded and denied before dispatch if input/output token or remaining dollar limits cannot be demonstrated. An offline estimate is not a billing guarantee; actual API usage and retry handling must be reconciled after each call.
3. Pin exact model IDs/prices and input/output budgets for each stage. Reject any unexpected model, stage or oversized prompt. Output-token ceilings alone do not constrain input cost.
4. Configure SITE_EDITORIAL_MAX_REPAIR_ROUNDS=0 **in Preview only** and validate it; the existing default is two.
5. Select five real TEST news IDs, verify trustworthy sources, confirm isolation, and snapshot current editorial approval state.
6. Resolve the currently exhausted OpenAI API credits, then seek separate explicit user authorization for the paid pilot.
7. Run tests/build and ensure all failure paths stop without approval or publication.

## Current status

- PR #28 baseline tests were reported as 215/215 and build passed in an isolated copy for a separate patch; **that patch is not present in this GitHub branch**.
- The existing Preview deployment and PR code were validated independently prior to this document, but no paid A/B pilot was run.
- USD 5 is an agreed planning ceiling, **not** permission to change billing or incur charges.

If cost cannot be bounded before dispatch, stop and require new authorization; never silently fall back to a different model or unlimited retry.
