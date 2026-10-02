import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSiteEditorialPreview, validateSiteEditorialInput } from '../lib/site-editorial.mjs';

function draft(bodyLength = 2500, excerptLength = 200) {
  const sizes = Array(8).fill(Math.floor((bodyLength - 14) / 8));
  sizes[0] += (bodyLength - 14) % 8;
  return { materia_site: sizes.map(n => 'a'.repeat(n - 1) + '.').join('\n\n'), resumo_site: 'r'.repeat(excerptLength) };
}
function validate(d) {
  return validateSiteEditorialInput({ materiaSite: d.materia_site, resumoSite: d.resumo_site });
}
const supabase = {
  from(table) {
    const result = { data: table === 'noticias' ? {id: 1, titulo: 'Noticia'} : [{nome:'Oficial', url:'https://example.com/source'}] };
    return { select() {return this;}, eq() {return this;}, maybeSingle: async () => result, order: async () => result };
  }
};
async function generate(sequence, run) {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.OPENAI_API_KEY;
  const requests = [];
  process.env.OPENAI_API_KEY = 'test-only';
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const next = sequence[requests.length - 1];
    if (next instanceof Error) throw next;
    assert.ok(next, 'Unexpected extra request');
    return {ok:true, json:async () => ({output_text: typeof next === 'string' ? next : JSON.stringify(next), output:[{content:[{annotations:[{type:'url_citation',url:'https://example.com/research',title:'Pesquisa'}]}]}]})};
  };
  try { await run(await generateSiteEditorialPreview({supabase, noticiaId:1}), requests); }
  finally { globalThis.fetch = oldFetch; if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; }
}

test('accepts inclusive character boundaries and rejects one character outside', () => {
  for (const length of [1800,3500]) assert.equal(validate(draft(length)).valid,true);
  for (const length of [1799,3501]) assert.equal(validate(draft(length)).valid,false);
  for (const length of [120,280]) assert.equal(validate(draft(2500,length)).valid,true);
  for (const length of [119,281]) assert.equal(validate(draft(2500,length)).valid,false);
});
test('valid first draft needs no revision', async () => {
  await generate([draft()], async (result, requests) => {
    assert.equal(result.status,200); assert.equal(requests.length,1);
    assert.match(requests[0].input,/mire 2400 a 2900/);
    assert.equal(result.json.data.diagnostico.caracteres,2500);
  });
});
test('revises short body and long excerpt using actual counts', async () => {
  await generate([draft(1799,281),draft()], async (result, requests) => {
    assert.equal(result.status,200); assert.equal(requests.length,2);
    assert.match(requests[1].input,/1799 caracteres e 8 paragrafos/);
    assert.match(requests[1].input,/281 caracteres/);
    assert.match(requests[1].input,/nao invente fatos/);
    assert.equal(result.json.data.fontes_pesquisa.length,1);
  });
});
test('second revision can correct long body and short excerpt', async () => {
  await generate([draft(3501,119),draft(3501,119),draft()], async (result, requests) => {
    assert.equal(result.status,200); assert.equal(requests.length,3);
    assert.match(requests[2].input,/3501 caracteres/);
    assert.match(requests[2].input,/119 caracteres/);
  });
});
test('persistent invalid output remains rejected after bounded revisions', async () => {
  await generate([draft(1799,119),draft(1799,119),draft(1799,119)], async (result, requests) => {
    assert.equal(result.status,422); assert.equal(requests.length,3);
    assert.equal(result.json.code,'INVALID_SITE_EDITORIAL');
    assert.equal(result.json.details.length,2);
  });
});
test('revision service failure keeps invalid content blocked', async () => {
  await generate([draft(3501),new Error('unavailable')], async result => assert.equal(result.status,422));
});
test('malformed initial JSON is rejected without revision', async () => {
  await generate(['invalid JSON'], async (result, requests) => {
    assert.equal(result.status,502); assert.equal(requests.length,1);
  });
});
