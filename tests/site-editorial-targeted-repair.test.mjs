import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTargetedEditorialRepair, validateSiteEditorialInput } from '../lib/site-editorial.mjs';

const paragraphs = Array.from({ length: 5 }, (_, i) =>
  `Parágrafo ${i + 1}: ${'Detalhes editoriais confirmados nas fontes disponíveis. '.repeat(6)}`.trim());
const body = paragraphs.join('\n\n');
const excerpt = 'Resumo editorial de fatos comprovados, sem inferências e sem comparações não sustentadas pelas fontes verificadas da matéria.';
const draft = validateSiteEditorialInput({ materiaSite: body, resumoSite: excerpt });

test('fixture follows editorial contract', () => {
  assert.equal(draft.valid, true, draft.errors.join('; '));
});

test('targeted repair preserves every other paragraph and summary', () => {
  const corrected = applyTargetedEditorialRepair(draft, 2, paragraphs[2].replace('confirmados', 'documentados'));
  assert.ok(corrected);
  assert.equal(corrected.excerpt, draft.excerpt);
  const next = corrected.body.split('\n\n');
  for (let i = 0; i < paragraphs.length; i++) {
    if (i !== 2) assert.equal(next[i], paragraphs[i]);
  }
});

test('summary repair preserves entire body', () => {
  const corrected = applyTargetedEditorialRepair(draft, paragraphs.length, excerpt.replace('comprovados', 'verificados'));
  assert.ok(corrected);
  assert.equal(corrected.body, draft.body);
});

test('rejects missing, invalid, or out-of-range replacement', () => {
  assert.equal(applyTargetedEditorialRepair(draft, 99, 'Texto'), null);
  assert.equal(applyTargetedEditorialRepair(draft, 0, ''), null);
  assert.equal(applyTargetedEditorialRepair(draft, 0, 'Curto'), null);
});
