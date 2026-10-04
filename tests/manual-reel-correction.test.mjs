import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { correctedEditorials, correctionSnapshot, reelAssetPrefix } from '../lib/manual-reel-correction.mjs';

const groupId = '12345678-1234-1234-1234-123456789012';
const slides = count => Array.from({ length: count }, (_, i) => ({ type: 'editorial',
  publication_id: null, banner_url: `https://example.com/new-${i+1}.png`, headline: `Editorial ${i+1}` }));
const fixture = () => [{ id: 289, noticia_id: 10, carousel_position: 1,
  banner_url: 'https://example.com/old.png', cta_url: 'https://example.com/cta.png',
  caption: 'Anterior', status: 'APROVADO', reel_asset_revision: null,
  atualizado_em: '2026-10-03T12:00:00+00:00', instagram_parent_container_id: 'old-container' }];

const api = readFileSync(new URL('../api/publicar.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '')
  .replace('export default async function handler', 'async function handler')
  .replace('await import("./auth.js")', '({ hasValidSession: () => true })')
  .replace("await import('node:crypto')", '({ createHash: hashImpl })');

function harness({ failRpc = false, failVideo = false, failVerify = false } = {}) {
  let rows = fixture(), revision, asset;
  const calls = [];
  const db = {
    from() {
      const q = { select() { return q; }, eq() { return q; },
        maybeSingle: async () => ({ data: { id: 289, publication_group_id: groupId } }),
        order: async () => ({ data: rows }) };
      return q;
    },
    async rpc(name, args) {
      calls.push(['rpc',name,args]);
      if (failRpc) return { error: { message: 'STALE_GROUP' } };
      if (revision !== args.p_revision) {
        revision = args.p_revision;
        rows = args.p_editorials.map((e,i) => ({ ...fixture()[0], ...e, id: 289+i,
          carousel_position: i+1, status: 'AGUARDANDO_APROVACAO',
          instagram_parent_container_id: null, instagram_caption_sha256: null,
          instagram_child_container_ids: [], reel_asset_revision: revision }));
        asset = null;
      }
      return { data: rows };
    },
  };
  const context = vm.createContext({ URL, Buffer, correctedEditorials, correctionSnapshot,
    reelAssetPrefix, hashImpl: createHash, console: { log() {}, error() {} }, process: { env: {} }, db,
    async video({ bannerUrls }) { calls.push(['video',bannerUrls]); if (failVideo) throw Error('video failed'); return { buffer: Buffer.from('mp4') }; },
    async upload(args) {
      calls.push(['upload',args.assetRevision]);
      asset={ storage_path: 'instagram-reels/'+reelAssetPrefix(groupId,args.assetRevision)+'-aaaaaaaaaaaaaaaa.mp4',
        video_url: 'https://example.com/new.mp4', sha256: 'a'.repeat(64), immutable: true };
      return asset;
    },
    async resolve(_db,_id,rev) {
      calls.push(['resolve',rev]);
      if (!asset || rev !== revision) throw Error('encontrados: 0');
      return { storagePath: asset.storage_path, videoUrl: asset.video_url,
        sha256: failVerify ? 'b'.repeat(64) : asset.sha256 };
    },
  });
  vm.runInContext(api + `
    getSupabase = () => db;
    buildInstagramReelVideo = video;
    uploadImmutableInstagramReelVideo = upload;
    resolveApprovedInstagramReelAsset = resolve;
    callInstagramApi = async () => { throw new Error('Meta must never be called'); };
    globalThis.invoke = handler;`,context);
  async function invoke(body = {}) {
    const res = { status(code) { this.statusCode=code; return this; },
      json(data) { this.data=JSON.parse(JSON.stringify(data)); return this; } };
    await context.invoke({ method: 'POST', body: { id: 289, noticia_id: 10,
      apply_corrected_banners: true, corrected_banners: slides(2),
      expected_group: correctionSnapshot(fixture()), ...body } }, res);
    return res;
  }
  return { invoke, calls };
}

for (const count of [1,2]) {
  test(`aplica ${count} editorial(is) + CTA no grupo existente sem Meta, com retry confirmado idempotente`,async () => {
    const h=harness();
    const result=await h.invoke({ corrected_banners: slides(count) });
    assert.equal(result.statusCode,200);
    assert.equal(result.data.publication_group_id,groupId);
    assert.equal(result.data.publicacoes[0].id,289);
    assert.deepEqual(result.data.frames,[...slides(count).map(s=>s.banner_url),'https://example.com/cta.png']);
    assert.equal(result.data.publicacoes.length,count);
    assert.equal(result.data.publish_called,false);
    assert.equal(result.data.instagram_api_called,false);
    assert.ok(result.data.publicacoes.every(row=>row.status==='AGUARDANDO_APROVACAO' && row.instagram_parent_container_id===null));
    assert.notEqual(reelAssetPrefix(groupId,result.data.reel_asset_revision),groupId);
    const repeated=await h.invoke({ corrected_banners: slides(count) });
    assert.equal(repeated.statusCode,200);
    assert.equal(repeated.data.reel_asset_revision,result.data.reel_asset_revision);
    assert.equal(h.calls.filter(c=>c[0]==='video').length,1);
    assert.ok(h.calls.filter(c=>c[0]==='rpc').every(c=>c[2].p_group_id===groupId));
  });
}

test('estado incerto bloqueia retry depois de RPC, render ou verificacao incompleta',async()=>{
  for (const config of [{failRpc:true},{failVideo:true},{failVerify:true}]) {
    const r=await harness(config).invoke();
    assert.equal(r.statusCode,409);
    assert.equal(r.data.do_not_retry,true);
    assert.equal(r.data.publish_called,false);
    assert.equal(r.data.instagram_api_called,false);
  }
});

test('rejeita noticia divergente e combinacao com publicacao antes de qualquer mutacao',async()=>{
  for (const body of [{noticia_id:11},{instagram_publish:true},{instagram_containers:true},{instagram_reel_asset:true}]) {
    const h=harness();
    const result=await h.invoke(body);
    assert.ok([400,409].includes(result.statusCode));
    assert.deepEqual(h.calls,[]);
  }
});

test('valida editoriais pendentes sem reordenar, duplicar ou descartar silenciosamente URLs invalidas',()=>{
  assert.deepEqual(correctedEditorials(slides(2)).map(x=>x.caption),['Editorial 1','Editorial 2']);
  for (const input of [[],slides(3),[slides(1)[0],slides(1)[0]],
    [{...slides(1)[0],banner_url:'http://example.com/a'}],
    [{...slides(1)[0],banner_url:'https://user:pass@example.com/a'}],
    [{...slides(1)[0],headline:''}]]) assert.throws(()=>correctedEditorials(input));
});

test('trava persistente e preflight invalidado antes de aplicar; sem chamada de publicacao na correcao',()=>{
  const panel=readFileSync(new URL('../src/PublicationPanel.jsx',import.meta.url),'utf8');
  const fn=panel.slice(panel.indexOf('async function applyCorrection()'),panel.indexOf('async function updatePublication('));
  assert.ok(fn.indexOf('setPreflight(null)')<fn.indexOf('apply_corrected_banners: true'));
  assert.ok(fn.indexOf("sessionStorage.setItem(correctionLockKey, 'uncertain')")<fn.indexOf('apply_corrected_banners: true'));
  assert.ok(!fn.includes('instagram_publish:') && !fn.includes('createReelContainer('));
  assert.ok(panel.includes('USAR ESTES BANNERS NA PUBLICAÇÃO'));
});

test('consulta real do asset ignora o MP4 antigo quando o grupo tem uma nova revisao',async()=>{
  const code=readFileSync(new URL('../api/publicacoes.js',import.meta.url),'utf8');
  const start=code.indexOf('async function resolveExistingInstagramReelAsset');
  const end=code.indexOf('export default',start);
  const searches=[];
  const revision='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const db={ storage:{ from:()=>({
    list:async(_folder,options)=>{searches.push(options.search);return {data:[{name:groupId+'-aaaaaaaaaaaaaaaa.mp4'}]};},
    download:async()=>{throw Error('Old MP4 must not be downloaded');},
  })}};
  const context=vm.createContext({reelAssetPrefix,createHash,Buffer});
  vm.runInContext(code.slice(start,end)+'\nglobalThis.resolve=resolveExistingInstagramReelAsset;',context);
  const result=await context.resolve(db,groupId,revision);
  assert.equal(result.exists,false);
  assert.equal(result.conflict,false);
  assert.deepEqual(searches,[groupId+'-'+revision+'-']);
});

test('publicacao bloqueia preflight antigo quando a reserva encontra assets ou container corrigidos',()=>{
  const start=api.indexOf('// Revalidate the locked rows');
  const end=api.indexOf('const idempotencyKey',start);
  const group=[{...fixture()[0],instagram_caption_sha256:'a'.repeat(64)}];
  for (const change of [{reel_asset_revision:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},
    {banner_url:'https://example.com/new.png'}, {instagram_parent_container_id:'new-container'}]) {
    const res={status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
    const context=vm.createContext({group,reservedGroup:[{...group[0],...change}],res});
    vm.runInContext('function verify(){'+api.slice(start,end)+'}\nverify();',context);
    assert.equal(res.code,409);
    assert.equal(res.data.publish_called,false);
    assert.equal(res.data.do_not_retry,true);
  }
});


test('snapshot inclui campos replicados sem copiar evidencias antigas',()=>{
  const row={...fixture()[0],selected_channels:['instagram'],scheduled_at:'2026-10-05T12:00:00Z',hashtags:'#cinema',banner_model_version:'v1'};
  const snap=correctionSnapshot([row])[0];
  for(const key of ['selected_channels','scheduled_at','hashtags','banner_model_version']) assert.deepEqual(snap[key],row[key]);
  assert.equal(snap.instagram_parent_container_id,'old-container');
});

test('RPC compartilha lock do auto-approve antes das linhas e nao contem DELETE',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261004035321_apply_corrected_publication_banners.sql',import.meta.url),'utf8');
  const approval=readFileSync(new URL('../supabase/migrations/20260930170000_allow_partial_auto_approve_publication_group.sql',import.meta.url),'utf8');
  assert.match(approval,/pg_advisory_xact_lock\(\s*p_noticia_id\s*\)/);
  assert.match(sql,/pg_advisory_xact_lock\(p_noticia_id\)/);
  assert.ok(sql.indexOf('pg_advisory_xact_lock')<sql.indexOf('for update'));
  assert.ok(sql.indexOf('EDITORIAL_REDUCTION_NOT_SUPPORTED')<sql.indexOf('insert into'));
  assert.doesNotMatch(sql,/\bdelete\s+from\b/i);
});
