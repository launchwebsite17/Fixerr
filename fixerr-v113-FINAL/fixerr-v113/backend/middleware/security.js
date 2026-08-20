// middleware/security.js - Security Headers & Directory Listing Protection
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Force HTTPS for a year (the app is served over TLS on Vercel/Render).
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Lock down powerful browser features the app never uses.
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), payment=()');
  next();
}

function blockDirectoryListing(req, res, next) {
  // Prevent directory traversal or direct access to sensitive config/source files
  const forbiddenPaths = ['.env', 'package.json', 'schema.sql', 'db.js', 'server.js', 'migrate.js'];
  const reqPath = req.path.toLowerCase();

  for (const fp of forbiddenPaths) {
    if (reqPath.includes(fp) || reqPath.endsWith('/')) {
      if (reqPath.endsWith('/') && reqPath !== '/') {
        return res.status(403).json({ error: 'Directory listing is forbidden.' });
      }
      if (forbiddenPaths.some(file => reqPath.endsWith(file))) {
        return res.status(403).json({ error: 'Direct file access forbidden.' });
      }
    }
  }
  next();
}

module.exports = { securityHeaders, blockDirectoryListing };
