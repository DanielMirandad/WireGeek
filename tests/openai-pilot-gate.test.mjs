import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAIResponse } from '../lib/openai-responses.mjs';

test('pilot editorial HTTP dispatch is blocked before API key or fetch', async () => {
  const before = process.env.SITE_EDITORIAL_AB_PILOT_ENABLED;
  process.env.SITE_EDITORIAL_AB_PILOT_ENABLED = '1';
  try {
    for (const purpose of ['site-editorial', 'site-editorial-verification', 'site-editorial-repair']) {
      await assert.rejects(
        createOpenAIResponse({ purpose, model: 'test-model', input: 'not sent' }),
        { message: 'EDITORIAL_PILOT_TRANSPORT_NOT_READY' },
      );
    }
  } finally {
    if (before === undefined) delete process.env.SITE_EDITORIAL_AB_PILOT_ENABLED;
    else process.env.SITE_EDITORIAL_AB_PILOT_ENABLED = before;
  }
});
