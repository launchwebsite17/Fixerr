// middleware/rateLimiter.js - Memory Rate Limiter
const rateLimitStore = {};

function rateLimit(windowMs, maxRequests, label) {
  return (req, res, next) => {
    const key = label + ':' + (req.ip || req.connection.remoteAddress || 'unknown');
    const now = Date.now();
    if (!rateLimitStore[key]) rateLimitStore[key] = [];
    rateLimitStore[key] = rateLimitStore[key].filter(t => now - t < windowMs);
    if (rateLimitStore[key].length >= maxRequests) {
      const retryAfterSec = Math.ceil((windowMs - (now - rateLimitStore[key][0])) / 1000);
      return res.status(429).json({ error: `Too many requests. Please try again in ${retryAfterSec} seconds.` });
    }
    rateLimitStore[key].push(now);
    next();
  };
}

const timer = setInterval(() => {
  const now = Date.now();
  Object.keys(rateLimitStore).forEach(key => {
    rateLimitStore[key] = rateLimitStore[key].filter(t => now - t < 15 * 60 * 1000);
    if (!rateLimitStore[key].length) delete rateLimitStore[key];
  });
}, 5 * 60 * 1000);
if (timer.unref) timer.unref();

const authLimiter = rateLimit(15 * 60 * 1000, 30, 'auth');
const bookingLimiter = rateLimit(60 * 60 * 1000, 20, 'booking');
const generalLimiter = rateLimit(60 * 1000, 60, 'general');

module.exports = { rateLimit, authLimiter, bookingLimiter, generalLimiter };
