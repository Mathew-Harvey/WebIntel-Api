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

// --- Static files (landing page + dashboard) ---
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

// --- Public routes (no auth) ---

app.get('/', (req, res) => {
  const acceptsHtml = (req.headers.accept || '').includes('text/html');
  if (acceptsHtml) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
  res.json({
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
    dashboard: 'https://webintel.dev/dashboard.html'
  });
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
