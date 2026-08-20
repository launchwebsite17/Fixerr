// backend/api/index.js - Serverless function entry point for Vercel.
// The Express app lives in backend/server.js (one level up). It serves both /api/* and the
// static frontend, and only calls app.listen() when run directly (local/Render); when required
// here it just exports the app for Vercel's serverless runtime.
const app = require('../server');

module.exports = async (req, res) => {
  if (app.initPromise) {
    await app.initPromise.catch(e => console.error('DB init warning in Vercel function:', e.message));
  }
  return app(req, res);
};
