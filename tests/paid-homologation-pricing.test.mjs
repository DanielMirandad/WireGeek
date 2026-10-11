import test from 'node:test';
import assert from 'node:assert/strict';
import { boundReservedTextCost, settleReservedTextCost } from '../lib/paid-homologation-pricing.mjs';
test('known standard models produce conservative integer micro-dollar ceilings', () => {
 assert.equal(boundReservedTextCost({model:'gpt-6-luna',maxInputTokens:1000,maxOutputTokens:1000}),600);
 assert.equal(boundReservedTextCost({model:'gpt-6-sol',maxInputTokens:1000,maxOutputTokens:1000}),12000);
 assert.equal(settleReservedTextCost({model:'gpt-6-luna',input_tokens:1000,output_tokens:1000}),600);
});
test('unknown models, tools, and oversize contexts fail closed', () => {
 assert.equal(boundReservedTextCost({model:'unknown',maxInputTokens:1000,maxOutputTokens:1000}),null);
 assert.equal(boundReservedTextCost({model:'gpt-6-luna',maxInputTokens:1000,maxOutputTokens:1000,tools:[{type:'web_search'}]}),null);
 assert.equal(boundReservedTextCost({model:'gpt-6-luna',maxInputTokens:128000,maxOutputTokens:1}),null);
});
