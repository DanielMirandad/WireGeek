import test from 'node:test';
import assert from 'node:assert/strict';
import { assessAutomaticImageReview } from '../lib/auto-image-review.mjs';
const host = 'assets.bosecreative.com';
const valid = () => ({
  url: 'https://assets.bosecreative.com/official.jpg',
  source_url: 'https://assets.bosecreative.com/press',
  width: 1600,
  height: 1200,
  fingerprint: { fullHash: 'a'.repeat(64) },
});
const config = { enabled: true, trustedHosts: [host] };
test('automatic image review is disabled by default', () => {
  assert.equal(assessAutomaticImageReview([valid()]).eligible, false);
});
test('verified first-party candidate is eligible for review, not publication', () => {
  assert.deepEqual(assessAutomaticImageReview([valid()], config), {
    eligible: true, review_status: 'AUTO_ELIGIBLE', reason: 'TRUSTED_IMAGE_CANDIDATE',
  });
});
test('unconfigured hosts fail closed', () => {
  assert.equal(assessAutomaticImageReview([valid()], { enabled: true }).reason, 'TRUSTED_HOSTS_NOT_CONFIGURED');
});
for (const [name, changed] of [
  ['search-engine image', { url: 'https://images.search.test/untrusted.jpg' }],
  ['unknown provenance', { source_url: '' }],
  ['similar hostname', { url: 'https://assets.bosecreative.com.evil.test/image.jpg' }],
  ['insecure URL', { url: 'http://assets.bosecreative.com/image.jpg' }],
  ['manual override', { manual_image_override: true }],
  ['small image', { width: 300 }],
  ['missing fingerprint', { fingerprint: null }],
]) {
  test(`review rejects ${name}`, () => {
    assert.equal(assessAutomaticImageReview([{ ...valid(), ...changed }], config).eligible, false);
  });
}
test('duplicate images are rejected', () => {
  assert.equal(assessAutomaticImageReview([valid(), valid()], config).reason, 'DUPLICATE_IMAGE');
});
test('no images are rejected', () => {
  assert.equal(assessAutomaticImageReview([], config).reason, 'IMAGE_COUNT_INVALID');
});

test('automatic eligibility never assigns publication approval', () => {
  const result = assessAutomaticImageReview([valid()], config);
  assert.equal(result.review_status, 'AUTO_ELIGIBLE');
  assert.equal(Object.hasOwn(result, 'status'), false);
  assert.equal(Object.hasOwn(result, 'approved'), false);
  assert.equal(Object.hasOwn(result, 'published'), false);
});
test('untrusted image remains in human review without publication approval', () => {
  const result = assessAutomaticImageReview([{ ...valid(), url: 'https://untrusted.test/photo.jpg' }], config);
  assert.equal(result.review_status, 'REVIEW_REQUIRED');
  assert.equal(result.eligible, false);
  assert.equal(Object.hasOwn(result, 'status'), false);
});
