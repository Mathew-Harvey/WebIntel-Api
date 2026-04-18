/**
 * WebIntel API
 * 
 * Link Preview + Screenshot API
 * REST endpoints + MCP server wrapper
 * 
 * GET /v1/preview?url=...     → OG/meta data as JSON
 * GET /v1/screenshot?url=...  → Screenshot as image or JSON
 * GET /health                 → Health check
 * GET /                       → API info
 * 
 * POST /api/signup            → Free key signup
 * POST /api/billing/checkout  → Stripe checkout for Pro
 * POST /api/billing/webhook   → Stripe webhook
 * POST /api/auth/magic-link   → Magic link login
 * GET  /api/auth/verify       → Verify magic link
 * GET  /api/dashboard         → Dashboard data
 */

require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { authenticate, loadKeys } = require('./middleware/auth');
const { limiter } = require('./middleware/rateLimit');
const previewRoutes = require('./routes/preview');
const screenshotRoutes = require('./routes/screenshot');
const signupRoutes = require('./routes/signup');
const billingRoutes = require('./routes/billing');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const wellKnownRoutes = require('./routes/wellKnown');
const { initDB } = require('./db');
const { closeBrowser } = require('./services/screenshot');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Stripe webhook needs raw body (must be before express.json) ---
app.post('/api/billing/webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => next()
);

// --- Global middleware ---
app.use(helmet({ contentSecurityPolicy: false }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length
    ? (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(null, false);
      }
    : true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key'],
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// --- Agent-readiness discovery (.well-known/*) ---
app.use('/.well-known', wellKnownRoutes);

// --- Static files (robots.txt, sitemap.xml, openapi.json, dashboard, skills) ---
app.use(express.static(path.join(__dirname, '..', 'public'), {
  index: false,
  extensions: ['html'],
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.md')) res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    if (filePath.endsWith('robots.txt')) res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  }
}));

// --- Public routes (no auth) ---

// Homepage — advertises discovery endpoints via Link headers (RFC 8288) and
// supports Markdown content negotiation for AI agents.
function setDiscoveryLinkHeaders(res) {
  res.setHeader(
    'Link',
    [
      '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
      '</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
      '<https://webintel.dev/docs>; rel="service-doc"; type="text/html"',
      '</.well-known/mcp/server-card.json>; rel="mcp-server"; type="application/json"',
      '</.well-known/agent-skills/index.json>; rel="agent-skills"; type="application/json"',
      '</.well-known/oauth-protected-resource>; rel="oauth-protected-resource"; type="application/json"',
      '</health>; rel="status"; type="application/json"'
    ].join(', ')
  );
  res.setHeader('Vary', 'Accept');
}

const ROOT_INFO = {
  name: 'WebIntel API',
  version: '1.0.0',
  description: 'Link Preview & Screenshot API for developers and LLMs',
  endpoints: {
    preview: {
      method: 'GET',
      path: '/v1/preview?url={url}',
      description: 'Extract Open Graph, Twitter Card, and meta data from any URL'
    },
    screenshot: {
      method: 'GET',
      path: '/v1/screenshot?url={url}',
      description: 'Capture a screenshot of any URL',
      params: 'width, height, format, quality, fullPage, darkMode, delay, response'
    }
  },
  auth: 'Include your API key via the x-api-key header',
  docs: 'https://webintel.dev/docs',
  pricing: 'https://webintel.dev/#pricing',
  dashboard: 'https://api.webintel.dev/dashboard.html',
  discovery: {
    apiCatalog: '/.well-known/api-catalog',
    openapi: '/openapi.json',
    mcpServerCard: '/.well-known/mcp/server-card.json',
    agentSkills: '/.well-known/agent-skills/index.json',
    oauthProtectedResource: '/.well-known/oauth-protected-resource'
  }
};

function rootAsMarkdown() {
  return `# WebIntel API

Link Preview & Screenshot API for developers and LLMs.

## Endpoints

- \`GET /v1/preview?url={url}\` — Extract Open Graph / Twitter Card / meta data.
- \`GET /v1/screenshot?url={url}\` — Capture a screenshot (png/jpeg/webp).
- \`GET /health\` — Service health.

## Authentication

Include your API key via the \`x-api-key\` request header.
Sign up free at https://api.webintel.dev/api/signup.

## Discovery

- API catalog: \`/.well-known/api-catalog\` (RFC 9727)
- OpenAPI: \`/openapi.json\`
- MCP server card: \`/.well-known/mcp/server-card.json\`
- Agent skills: \`/.well-known/agent-skills/index.json\`
- OAuth protected resource: \`/.well-known/oauth-protected-resource\`

## Links

- Docs: https://webintel.dev/docs
- Pricing: https://webintel.dev/#pricing
- Dashboard: https://api.webintel.dev/dashboard.html
`;
}

app.get('/', (req, res) => {
  setDiscoveryLinkHeaders(res);

  const accept = (req.headers.accept || '').toLowerCase();
  const wantsMarkdown = accept.includes('text/markdown');
  const wantsHtml = accept.includes('text/html');
  const wantsJson = accept.includes('application/json');

  if (wantsMarkdown) {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    return res.send(rootAsMarkdown());
  }

  // Browsers go to the marketing site; agents and JSON clients get JSON info.
  if (wantsHtml && !wantsJson) {
    return res.redirect(301, 'https://webintel.dev');
  }

  res.json(ROOT_INFO);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// --- Public API routes ---
app.use('/api/signup', signupRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);

// --- Protected routes (auth + rate limit) ---
app.use('/v1/preview', authenticate, limiter, previewRoutes);
app.use('/v1/screenshot', authenticate, limiter, screenshotRoutes);

// --- 404 handler ---
app.use((req, res) => {
  res.status(404).json({
    error: 'not_found',
    message: `No route matches ${req.method} ${req.path}`,
    docs: 'https://webintel.dev/docs'
  });
});

// --- Error handler ---
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({
    error: 'internal_error',
    message: process.env.NODE_ENV === 'production'
      ? 'Something went wrong'
      : err.message
  });
});

// --- Start server ---
async function start() {
  loadKeys();

  if (process.env.DATABASE_URL) {
    try {
      await initDB();
    } catch (err) {
      console.error('[startup] Database init failed:', err.message);
      console.warn('[startup] Running without database — using in-memory keys only');
    }
  } else {
    console.log('[startup] No DATABASE_URL — using in-memory keys only');
  }

  const server = app.listen(PORT, () => {
    console.log(`
┌─────────────────────────────────────┐
│         WebIntel API v1.0.0         │
├─────────────────────────────────────┤
│  REST:  http://localhost:${PORT}        │
│  Docs:  http://localhost:${PORT}/       │
│  Health: http://localhost:${PORT}/health│
│  Dashboard: /dashboard.html         │
└─────────────────────────────────────┘
    `);
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[${signal}] Shutting down...`);
    try { await closeBrowser(); } catch (err) {
      console.error('[shutdown] Error closing browser:', err.message);
    }
    server.close(() => {
      console.log('[shutdown] Complete');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[shutdown] Forceful exit after timeout');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();

module.exports = app;
