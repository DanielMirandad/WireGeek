import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPreviewPublishTarget } from '../lib/preview-publish-target.mjs';

const host = 'bagaca-cast-site-1vvlzd5fi-danielmirandads-projects.vercel.app';
const suffix = '/api/integrations/wiregeek/publish';
const preview = { VERCEL_ENV: 'preview', BAGACA_SITE_PREVIEW_PUBLISH_HOST: host };
test('permite Preview explicitamente autorizado', () => {
  assert.doesNotThrow(() => assertPreviewPublishTarget(new URL(`https://${host}${suffix}`), preview));
});
for (const [name, url, env] of [
  ['configuracao ausente', `https://${host}${suffix}`, { VERCEL_ENV: 'preview' }],
  ['producao', `https://bagacacast.com${suffix}`, preview],
  ['dominio semelhante', `https://${host}.evil.test${suffix}`, preview],
  ['outro Preview', `https://bagaca-cast-site-aaaaaaaa-danielmirandads-projects.vercel.app${suffix}`, preview],
  ['porta', `https://${host}:8443${suffix}`, preview],
  ['usuario', `https://user@${host}${suffix}`, preview],
  ['query', `https://${host}${suffix}?x=1`, preview],
  ['fragmento', `https://${host}${suffix}#x`, preview],
  ['http', `http://${host}${suffix}`, preview],
  ['host arbitrario', `https://evil.test${suffix}`, { VERCEL_ENV: 'preview', BAGACA_SITE_PREVIEW_PUBLISH_HOST: 'evil.test' }],
]) {
  test(`bloqueia ${name}`, () => assert.throws(() => assertPreviewPublishTarget(new URL(url), env), /nao autorizado/));
}
test('nao modifica validacao de producao', () => {
  assert.doesNotThrow(() => assertPreviewPublishTarget(new URL('https://bagacacast.com'), { VERCEL_ENV: 'production' }));
});
