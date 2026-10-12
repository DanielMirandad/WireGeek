import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { PGlite } from '@electric-sql/pglite';
import useSiteDraft from '../src/useSiteDraft.js';
import { createDraftAutosave } from '../src/site-draft-autosave.mjs';
import handler from '../lib/site-publish-handler.mjs';

const value = { materia_site: 'Rascunho incompleto\n\nAinda em edicao.', resumo_site: '', image_url: 'https://example.org/image.png' };
const response = () => ({ status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; }, setHeader() {} });
const request = (body = {}) => ({ method: 'POST', headers: { 'x-wiregeek-automation-key': 'draft-test' }, body: { noticia_id: 7, action: 'save-draft', ...value, ...body } });
function memoryDb() {
  const rows = new Map();
  return { rows, from(table) {
    assert.equal(table, 'site_editorial_drafts', 'Draft actions must never access approvals, publicacoes or site_news');
    let id, record;
    return { select() { return this; }, eq(_, key) { id = key; return this; },
      upsert(data, options) { assert.equal(options.onConflict, 'noticia_id'); record = data; return this; },
      async single() { rows.set(record.noticia_id, { ...record }); return { data: record }; },
      async maybeSingle() { return { data: rows.get(id) || null }; },
    };
  } };
}

test('backend round-trips raw partial drafts by news ID without approval or publication', async () => {
  const key = process.env.WIREGEEK_AUTOMATION_KEY, originalFetch = globalThis.fetch;
  process.env.WIREGEEK_AUTOMATION_KEY = 'draft-test';
  globalThis.fetch = () => assert.fail('Draft action must never call external services');
  const supabase = memoryDb();
  try {
    const saved = response();
    await handler(request({ approved_at: 'forged', status: 'published', approval_receipt: 'forged' }), saved, { supabase });
    assert.equal(saved.code, 200);
    assert.deepEqual(Object.keys(saved.data.data).sort(), ['image_url', 'materia_site', 'noticia_id', 'resumo_site', 'updated_at']);
    const loaded = response();
    await handler({ ...request(), method: 'GET', query: { action: 'draft', noticia_id: 7 } }, loaded, { supabase });
    assert.deepEqual(loaded.data.data, saved.data.data);
    const other = response();
    await handler({ ...request(), method: 'GET', query: { action: 'draft', noticia_id: 8 } }, other, { supabase });
    assert.equal(other.data.data, null);
    const cleared = response();
    await handler(request({ materia_site: '', resumo_site: '', image_url: '' }), cleared, { supabase });
    assert.equal(cleared.code, 200);
    assert.equal(supabase.rows.get(7).image_url, '');
    for (const bad of [{ materia_site: null }, { resumo_site: 'x'.repeat(5001) }, { image_url: {} }, { noticia_id: 0 }]) {
      const result = response();
      await handler(request(bad), result, { supabase: { from() { assert.fail('Invalid draft read'); } } });
      assert.equal(result.code, 422);
    }
    const unauthorized = response();
    await handler({ ...request(), headers: {} }, unauthorized, { supabase: { from() { assert.fail('Unauthorized access'); } } });
    assert.equal(unauthorized.code, 401);
    for (const method of ['POST', 'GET']) {
      const unavailable = response();
      const chain = { select() { return this; }, eq() { return this; }, upsert() { return this; },
        single: async () => ({ error: {} }), maybeSingle: async () => ({ error: {} }) };
      await handler({ ...request(), method, query: { action: 'draft', noticia_id: 7 } }, unavailable, { supabase: { from: () => chain } });
      assert.equal(unavailable.code, 503);
      assert.equal(unavailable.data.code, 'EDITORIAL_DRAFT_STORAGE_UNAVAILABLE');
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (key === undefined) delete process.env.WIREGEEK_AUTOMATION_KEY; else process.env.WIREGEEK_AUTOMATION_KEY = key;
  }
});

test('migration supports partial drafts, service writes, FK and denies direct public access', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE noticias(id bigint PRIMARY KEY); INSERT INTO noticias VALUES (7);
      CREATE TABLE site_news(id bigint PRIMARY KEY); CREATE TABLE site_editorial_approvals(noticia_id bigint PRIMARY KEY);`);
    await db.exec(readFileSync(new URL('../supabase/migrations/20261012030611_site_editorial_drafts.sql', import.meta.url), 'utf8'));
    await db.exec('SET ROLE service_role');
    await db.query('INSERT INTO site_editorial_drafts(noticia_id,materia_site,resumo_site,image_url) VALUES ($1,$2,$3,$4)', [7, value.materia_site, '', value.image_url]);
    await db.query(`INSERT INTO site_editorial_drafts(noticia_id,materia_site) VALUES (7,'Editado') ON CONFLICT(noticia_id) DO UPDATE SET materia_site=excluded.materia_site`);
    assert.equal((await db.query('SELECT * FROM site_editorial_drafts')).rows[0].materia_site, 'Editado');
    await assert.rejects(db.query('INSERT INTO site_editorial_drafts(noticia_id) VALUES (8)'), /foreign key/);
    await assert.rejects(db.query('UPDATE site_editorial_drafts SET resumo_site=$1', ['x'.repeat(5001)]), /check constraint/);
    await db.exec('RESET ROLE');
    assert.equal((await db.query('SELECT * FROM site_news')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM site_editorial_approvals')).rows.length, 0);
    assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE relname='site_editorial_drafts'")).rows[0].relrowsecurity, true);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query('SELECT * FROM site_editorial_drafts'), /permission denied/);
      await assert.rejects(db.query('UPDATE site_editorial_drafts SET materia_site=\'forged\''), /permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('DELETE FROM noticias WHERE id=7');
    assert.equal((await db.query('SELECT * FROM site_editorial_drafts')).rows.length, 0);
  } finally { await db.close(); }
});

test('autosave debounces 1500ms, serializes edits, flushes and retries failure', async () => {
  const writes = [], notices = [];
  let callback, release, fail = false;
  const saver = createDraftAutosave({ schedule(fn, delay) { assert.equal(delay, 1500); callback = fn; return fn; }, cancel() {},
    notify: state => notices.push(state), save: async v => {
      writes.push(v); if (fail) throw new Error('offline');
      if (writes.length === 1) await new Promise(resolve => { release = resolve; });
    } });
  saver.update({ body: 'a' }); saver.update({ body: 'b' });
  assert.equal(writes.length, 0);
  callback();
  await Promise.resolve();
  assert.equal(writes[0].body, 'b');
  saver.update({ body: 'c' }); release();
  await saver.flush();
  assert.deepEqual(writes.map(v => v.body), ['b', 'c']);
  assert.equal(notices.at(-1), 'saved');
  fail = true;
  saver.update({ body: 'd' });
  await assert.rejects(saver.flush(), /offline/);
  assert.equal(notices.at(-1), 'error');
  assert.equal(saver.isDirty(), true);
  fail = false;
  await saver.flush();
  assert.equal(saver.isDirty(), false);
  saver.update({ body: 'e' });
  await saver.dispose();
  assert.equal(writes.at(-1).body, 'e');
});

test('React hook restores reload, saves generation/edits, clears image and isolates news switches', async () => {
  const globals = Object.fromEntries(['fetch', 'window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, globalThis[key]]));
  const win = new EventTarget(), doc = new EventTarget();
  Object.assign(globalThis, { window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true });
  const rows = new Map(), calls = [];
  let current, view, failSave = false, failLoad = false, slowResolve;
  globalThis.fetch = async (url, options = {}) => {
    const query = new URL(url, 'https://example.org').searchParams;
    if (options.method === 'POST') {
      const body = JSON.parse(options.body); calls.push(body);
      assert.equal(body.action, 'save-draft'); assert.equal(options.keepalive, true);
      if (failSave) return { ok: false, json: async () => ({ error: 'offline' }) };
      rows.set(body.noticia_id, body);
      return { ok: true, json: async () => ({ data: body }) };
    }
    const id = Number(query.get('noticia_id'));
    if (query.get('action') === 'draft') {
      if (id === 99) await new Promise(resolve => { slowResolve = resolve; });
      return { ok: !failLoad, json: async () => ({ data: rows.get(id) || null, error: 'storage unavailable' }) };
    }
    return { ok: true, json: async () => ({ data: { materia_site: 'Legacy approved', resumo_site: 'Legacy summary', body: 'Published', excerpt: 'Published summary', image_url: 'https://example.org/legacy.png' } }) };
  };
  function Probe({ id }) { current = useSiteDraft(id, 'https://example.org/fallback.png'); return null; }
  const render = id => act(async () => {
    if (view) view.update(React.createElement(Probe, { id })); else view = create(React.createElement(Probe, { id }));
  });
  try {
    rows.set(7, { ...value, image_url: '' });
    await render(7);
    const obsoleteGeneration = current.generated;
    assert.equal(current.fields.materia_site, value.materia_site);
    assert.equal(current.fields.image_url, '', 'Explicit empty wins over published image');
    assert.equal(calls.length, 0, 'Hydration must not autosave or approve');
    await act(async () => { current.generated('Generated body', 'Generated summary'); });
    assert.equal(calls.length, 1, 'Generation saves immediately');
    await act(async () => { current.setBody('Edited body'); current.setExcerpt('Edited summary'); current.setImage('https://example.org/new.png'); });
    assert.equal(calls.length, 1);
    await act(async () => { win.dispatchEvent(new Event('pagehide')); });
    assert.equal(calls.length, 2);
    assert.equal(rows.get(7).materia_site, 'Edited body');
    await act(async () => { view.unmount(); }); view = null;
    await render(7);
    assert.deepEqual(current.fields, { materia_site: 'Edited body', resumo_site: 'Edited summary', image_url: 'https://example.org/new.png' });
    await act(async () => { current.setImage(''); });
    await render(8); // Cleanup flushes the old news before its panel is discarded.
    assert.equal(rows.get(7).image_url, '');
    assert.equal(current.fields.materia_site, 'Legacy approved');
    await act(async () => { current.generated('News eight', 'Summary eight'); });
    assert.equal(rows.get(8).materia_site, 'News eight');
    await render(7);
    assert.equal(current.fields.materia_site, 'Edited body');
    const beforeStale = calls.length;
    await act(async () => { obsoleteGeneration('Obsolete generation', 'Obsolete summary'); });
    assert.equal(calls.length, beforeStale, 'Old selection callbacks cannot overwrite a reopened news item');
    failSave = true;
    await act(async () => { current.generated('Unsaved', 'Summary'); });
    assert.equal(current.status, 'error');
    const unload = new Event('beforeunload', { cancelable: true });
    await act(async () => { win.dispatchEvent(unload); });
    assert.equal(unload.defaultPrevented, true, 'Unsaved content must warn before reload');
    failSave = false;
    await act(async () => { current.retry(); });
    assert.equal(current.status, 'saved');
    await render(99);
    await render(8);
    await act(async () => { slowResolve(); });
    assert.equal(current.fields.materia_site, 'News eight', 'Late response must not overwrite selected news');
    failLoad = true;
    await render(10);
    assert.equal(current.blocked, true);
    await act(async () => { current.setBody('Do not overwrite storage on failed load'); });
    assert.equal(rows.has(10), false);
  } finally {
    if (view) await act(async () => { view.unmount(); });
    for (const [key, val] of Object.entries(globals)) {
      if (val === undefined) delete globalThis[key]; else globalThis[key] = val;
    }
  }
});

test('publish accepts valid text and explicit HTTPS image without requiring approval', async () => {
  const keys = ['WIREGEEK_AUTOMATION_KEY', 'BAGACA_SITE_PUBLISH_URL', 'BAGACA_SITE_PUBLISH_KEY'];
  const saved = keys.map(key => [key, process.env[key]]), original = globalThis.fetch;
  Object.assign(process.env, { WIREGEEK_AUTOMATION_KEY: 'draft-test', BAGACA_SITE_PUBLISH_URL: 'https://example.org/api/integrations/wiregeek/publish', BAGACA_SITE_PUBLISH_KEY: 'fixture' });
  const body = Array.from({ length: 3 }, (_, i) => `Paragrafo ${i}. ` + 'a'.repeat(610)).join('\n\n');
  const excerpt = 'b'.repeat(150);
  const publication = { slug: 'fixture', status: 'published' };
  const db = { from(table) {
    assert.equal(table, 'site_news');
    const chain = { select() { return this; }, eq() { return this; }, limit: async () => ({ data: [publication] }) };
    return chain;
  } };
  try {
    globalThis.fetch = async (_, options) => {
      assert.deepEqual(JSON.parse(options.body), { noticia_id: 7, materia_site: body, resumo_site: excerpt, image_url: value.image_url });
      return { ok: true, status: 201, json: async () => ({ action: 'published' }) };
    };
    const result = response();
    await handler(request({ action: 'publish', materia_site: body, resumo_site: excerpt }), result, { supabase: db });
    assert.equal(result.code, 201);
  } finally {
    globalThis.fetch = original;
    for (const [key, val] of saved) { if (val === undefined) delete process.env[key]; else process.env[key] = val; }
  }
});


test('generation autosaves with one inference; optional verification timeout preserves persisted draft and publication', async () => {
  const env = Object.fromEntries(['WIREGEEK_AUTOMATION_KEY', 'BAGACA_SITE_PUBLISH_URL', 'BAGACA_SITE_PUBLISH_KEY'].map(k => [k, process.env[k]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, { WIREGEEK_AUTOMATION_KEY: 'draft-test', BAGACA_SITE_PUBLISH_URL: 'https://example.org/api/integrations/wiregeek/publish', BAGACA_SITE_PUBLISH_KEY: 'synthetic-key' });
  const stored = memoryDb(), calls = [];
  const valid = { materia_site: Array.from({ length: 4 }, (_, i) => 'Fato ' + i + ': ' + 'a'.repeat(450)).join('\n\n'), resumo_site: 'Resumo: ' + 'b'.repeat(130) };
  const supabase = { from(table) {
    if (table === 'site_editorial_drafts') return stored.from(table);
    assert.equal(table, 'noticias', 'Verification must never access approval/publication tables');
    return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id: 7, titulo: 'Fixture', categoria: 'Games', url: 'https://example.org/source', fontes: [] } }) };
  } };
  const editorialOptions = {
    generationCache: { run: async (_, execute) => execute() },
    captureSource: async () => ({ text: 'Source fixture with literal independently captured evidence.', final_url: 'https://example.org/source', source_hash: 'sha256:' + 'a'.repeat(64) }),
    createResponse: async req => {
      calls.push(req.purpose);
      if (req.purpose === 'site-editorial-verification') throw new Error('OPENAI_TIMEOUT');
      return { text: JSON.stringify(valid) };
    },
  };
  try {
    const generated = response();
    await handler(request({ action: 'generate-editorial' }), generated, { supabase, editorialOptions });
    assert.equal(generated.code, 200);
    assert.deepEqual(calls, ['site-editorial']);
    const saver = createDraftAutosave({ save: async fields => {
      const saved = response();
      await handler(request(fields), saved, { supabase });
      assert.equal(saved.code, 200);
    } });
    saver.update({ ...generated.data.data, image_url: value.image_url });
    await saver.flush();
    const before = structuredClone(stored.rows.get(7));
    const timeout = response();
    await handler(request({ action: 'verify-editorial', ...valid }), timeout, { supabase, editorialOptions });
    assert.equal(timeout.code, 504);
    assert.equal(timeout.data.code, 'EDITORIAL_VERIFICATION_API_FAILED');
    assert.deepEqual(timeout.data.details, ['OPENAI_TIMEOUT']);
    assert.deepEqual(stored.rows.get(7), before);
    const loaded = response();
    await handler({ ...request(), method: 'GET', query: { action: 'draft', noticia_id: 7 } }, loaded, { supabase });
    assert.deepEqual(loaded.data.data, before);
    // Edits and autosave continue after the optional failure.
    saver.update({ ...valid, resumo_site: valid.resumo_site + ' Editado.', image_url: value.image_url });
    await saver.flush();
    assert.equal(stored.rows.get(7).resumo_site, valid.resumo_site + ' Editado.');
    await saver.dispose();
    globalThis.fetch = async (_, options) => {
      assert.deepEqual(JSON.parse(options.body), { noticia_id: 7, ...valid, resumo_site: valid.resumo_site + ' Editado.', image_url: value.image_url });
      return { ok: true, status: 201, json: async () => ({ action: 'published' }) };
    };
    const publication = response();
    const publicationDb = { from(table) {
      assert.equal(table, 'site_news', 'Publishing must not require optional verification or approval');
      const chain = { then(resolve) { resolve({ data: [{ slug: 'fixture' }] }); } };
      for (const method of ['select', 'eq', 'order', 'limit']) chain[method] = () => chain;
      return chain;
    } };
    await handler(request({ action: 'publish', ...stored.rows.get(7) }), publication, { supabase: publicationDb });
    assert.equal(publication.code, 201);
    assert.deepEqual(calls, ['site-editorial', 'site-editorial-verification']);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
