// Read-only image review decision. Never modifies publication approval/status.
function hostname(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password ||
        url.port || url.search || url.hash) return null;
    return url.hostname.toLowerCase();
  } catch { return null; }
}

export function assessAutomaticImageReview(images, {
  enabled = false,
  trustedHosts = [],
} = {}) {
  if (!enabled) return { eligible: false, reason: 'AUTO_IMAGE_REVIEW_DISABLED' };
  if (!Array.isArray(images) || images.length < 1 || images.length > 2) {
    return { eligible: false, reason: 'IMAGE_COUNT_INVALID' };
  }
  const allowed = new Set(
    (Array.isArray(trustedHosts) ? trustedHosts : [])
      .map(host => String(host).trim().toLowerCase())
      .filter(host => /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(host))
  );
  if (allowed.size === 0) return { eligible: false, reason: 'TRUSTED_HOSTS_NOT_CONFIGURED' };
  const seen = new Set();
  for (const image of images) {
    const host = hostname(image?.url);
    const sourceHost = hostname(image?.source_url);
    if (!host || !allowed.has(host) || !sourceHost || !allowed.has(sourceHost)) {
      return { eligible: false, reason: 'SOURCE_NOT_VERIFIED' };
    }
    if (image?.manual_image_override === true ||
        !Number.isInteger(image?.width) || !Number.isInteger(image?.height) ||
        image.width < 900 || image.height < 600 ||
        !image?.fingerprint?.fullHash) {
      return { eligible: false, reason: 'IMAGE_NOT_VALIDATED' };
    }
    if (seen.has(image.fingerprint.fullHash)) {
      return { eligible: false, reason: 'DUPLICATE_IMAGE' };
    }
    seen.add(image.fingerprint.fullHash);
  }
  return { eligible: true, reason: 'TRUSTED_IMAGE_CANDIDATE' };
}
