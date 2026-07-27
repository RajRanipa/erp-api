const buckets = new Map();

function cleanup(now) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit({
  windowMs = 15 * 60 * 1000,
  max = 20,
  key = (req) => req.ip || req.socket?.remoteAddress || 'unknown',
  message = 'Too many requests. Please try again later.',
} = {}) {
  return (req, res, next) => {
    const now = Date.now();
    cleanup(now);
    const bucketKey = `${req.baseUrl}:${req.path}:${key(req)}`;
    let bucket = buckets.get(bucketKey);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(bucketKey, bucket);
    }

    bucket.count += 1;
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(max - bucket.count, 0)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ status: false, message });
    }

    return next();
  };
}

export const authRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
export const otpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  key: (req) => `${req.ip || 'unknown'}:${String(req.body?.email || '').trim().toLowerCase()}`,
  message: 'Too many verification requests. Please wait before trying again.',
});

