import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reelAssetPrefix } from '../lib/manual-reel-correction.mjs';

const groupId = '6350d973-40b2-4d8b-b36e-54791474d24f';
const revision = '12345678-1234-4234-8234-123456789abc';

test('reelAssetPrefix preserva asset legado sem revisao', () => {
  assert.equal(reelAssetPrefix(groupId, null), groupId);
});

test('reelAssetPrefix inclui reel_asset_revision', () => {
  assert.equal(
    reelAssetPrefix(groupId, revision),
    `${groupId}-${revision}`
  );
});

test('YouTube resolve o MP4 pela revisao atual do grupo', () => {
  const source = readFileSync(
    new URL('../api/youtube.js', import.meta.url),
    'utf8'
  );

  assert.match(source, /reelAssetPrefix/);
  assert.match(source, /cta_url,reel_asset_revision/);
  assert.match(
    source,
    /const revision=rows\[0\]\?\.reel_asset_revision \?\? null/
  );
  assert.match(
    source,
    /const assetPrefix=reelAssetPrefix\(groupId,revision\)/
  );
  assert.match(
    source,
    /search:assetPrefix\+'-'/
  );
});