/**
 * Targeted in-memory sliding-window rate limiter
 * Protects costly endpoints (Auth, OTP, Blueprint generation)
 * Returns 429 Too Many Requests with Retry-After header.
 */

const clientBuckets = new Map();

// Periodic garbage collection of old client entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of clientBuckets.entries()) {
    if (now > record.resetAt) {
      clientBuckets.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

function createRateLimiter({
  windowMs = 60 * 1000,
  maxRequests = 10,
  message = 'Too many requests. Please try again shortly.',
  keyGenerator = (req) => req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
}) {
  return function rateLimiter(req, res, next) {
    // Bypass in test mode if explicitly requested
    if (process.env.DISABLE_RATE_LIMIT === 'true') {
      return next();
    }

    const key = `${req.baseUrl || ''}:${req.path}:${keyGenerator(req)}`;
    const now = Date.now();

    let record = clientBuckets.get(key);
    if (!record || now >= record.resetAt) {
      record = {
        count: 1,
        resetAt: now + windowMs,
      };
      clientBuckets.set(key, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, maxRequests - record.count);
    const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000));

    if (record.count > maxRequests) {
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({
        message,
        retryAfter: retryAfterSec,
      });
    }

    next();
  };
}

module.exports = { createRateLimiter };

