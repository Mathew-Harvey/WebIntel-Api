/**
 * Agent-readiness discovery endpoints.
 *
 * Implements the well-known resources that let AI agents discover
 * WebIntel's API, MCP server, skills, and auth model:
 *
 *   /.well-known/api-catalog               (RFC 9727)
 *   /.well-known/oauth-protected-resource  (RFC 9728)
 *   /.well-known/oauth-authorization-server(RFC 8414)
 *   /.well-known/mcp/server-card.json      (SEP-1649)
 *   /.well-known/agent-skills/index.json   (Agent Skills Discovery RFC v0.2.0)
 *   /.well-known/agent-skills/:name/SKILL.md
 *
 * Also serves /openapi.json (static from public/) as the API description.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const webBotAuth = require('../services/webBotAuth');

const SITE_URL = process.env.SITE_URL || 'https://webintel.dev';
const API_URL = process.env.API_URL || 'https://api.webintel.dev';
const MCP_URL = process.env.MCP_URL || `${API_URL}/mcp`;

const SKILLS_DIR = path.join(__dirname, '..', '..', 'public', 'agent-skills');

function sha256(buf) {
  return 'sha256-' + crypto.createHash('sha256').update(buf).digest('base64');
}

function loadSkill(name) {
  const file = path.join(SKILLS_DIR, name, 'SKILL.md');
  if (!fs.existsSync(file)) return null;
  const body = fs.readFileSync(file);
  return { body, digest: sha256(body) };
}

const router = express.Router();

// --- API Catalog (RFC 9727) -------------------------------------------------
router.get('/api-catalog', (req, res) => {
  res.type('application/linkset+json').json({
    linkset: [
      {
        anchor: `${API_URL}/`,
        'service-desc': [
          { href: `${API_URL}/openapi.json`, type: 'application/vnd.oai.openapi+json' }
        ],
        'service-doc': [
          { href: `${SITE_URL}/docs`, type: 'text/html' }
        ],
        'service-meta': [
          { href: `${API_URL}/.well-known/oauth-protected-resource`, type: 'application/json' }
        ],
        status: [
          { href: `${API_URL}/health`, type: 'application/json' }
        ],
        terms: [
          { href: `${SITE_URL}/terms`, type: 'text/html' }
        ]
      }
    ]
  });
});

// --- OAuth Protected Resource (RFC 9728) ------------------------------------
// WebIntel uses API keys, not OAuth. We still publish the metadata so agents
// can discover the authentication scheme.
router.get('/oauth-protected-resource', (req, res) => {
  res.type('application/json').json({
    resource: `${API_URL}/`,
    authorization_servers: [API_URL],
    scopes_supported: ['preview:read', 'screenshot:read'],
    bearer_methods_supported: [],
    resource_name: 'WebIntel API',
    resource_documentation: `${SITE_URL}/docs`,
    authentication_schemes: [
      {
        scheme: 'ApiKey',
        in: 'header',
        name: 'x-api-key',
        signup: `${API_URL}/api/signup`,
        documentation: `${SITE_URL}/docs#auth`
      }
    ]
  });
});

// --- OAuth Authorization Server (RFC 8414) ----------------------------------
// Minimal metadata describing the API-key-based auth flow. No OAuth grants
// are supported, but the issuer advertises where keys are obtained.
router.get('/oauth-authorization-server', (req, res) => {
  res.type('application/json').json({
    issuer: API_URL,
    authorization_endpoint: `${SITE_URL}/#pricing`,
    token_endpoint: `${API_URL}/api/signup`,
    registration_endpoint: `${API_URL}/api/signup`,
    jwks_uri: `${API_URL}/.well-known/jwks.json`,
    scopes_supported: ['preview:read', 'screenshot:read'],
    response_types_supported: [],
    grant_types_supported: [],
    token_endpoint_auth_methods_supported: ['none'],
    service_documentation: `${SITE_URL}/docs`,
    ui_locales_supported: ['en-AU', 'en-US']
  });
});

// Empty JWKS so clients that fetch it don't 404.
router.get('/jwks.json', (req, res) => {
  res.type('application/json').json({ keys: [] });
});

// --- Web Bot Auth directory (HTTP Message Signatures) -----------------------
// https://datatracker.ietf.org/wg/webbotauth/about/
router.get('/http-message-signatures-directory', (req, res) => {
  const authority = req.headers.host || new URL(API_URL).host;
  const { signatureInput, signature } = webBotAuth.signDirectoryResponse({ authority });

  res.setHeader('Content-Type', 'application/http-message-signatures-directory+json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Signature-Input', signatureInput);
  res.setHeader('Signature', signature);

  res.send(JSON.stringify({ keys: [webBotAuth.getJwk()] }));
});

// --- MCP Server Card (SEP-1649) ---------------------------------------------
router.get('/mcp/server-card.json', (req, res) => {
  res.type('application/json').json({
    $schema: 'https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/server-card.schema.json',
    serverInfo: {
      name: 'webintel',
      title: 'WebIntel',
      version: '1.0.0',
      description:
        'Extract Open Graph metadata and capture screenshots of any public URL. ' +
        'Useful for link previews, visual verification, and page summaries.',
      homepage: SITE_URL,
      documentation: `${SITE_URL}/docs`,
      vendor: 'WebIntel',
      license: 'MIT'
    },
    transports: [
      { type: 'stdio', command: 'npx', args: ['@webintel/mcp'] },
      { type: 'streamable-http', url: MCP_URL }
    ],
    authentication: {
      type: 'api_key',
      location: 'header',
      name: 'x-api-key',
      signup: `${API_URL}/api/signup`
    },
    capabilities: {
      tools: {
        listChanged: false
      }
    },
    tools: [
      {
        name: 'link_preview',
        description: 'Extract Open Graph / Twitter Card / meta data from any URL.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', format: 'uri' }
          },
          required: ['url']
        }
      },
      {
        name: 'take_screenshot',
        description: 'Capture a screenshot of a URL. Returns image + metadata.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', format: 'uri' },
            width: { type: 'integer' },
            height: { type: 'integer' },
            format: { type: 'string', enum: ['png', 'jpeg', 'webp'] },
            fullPage: { type: 'boolean' },
            darkMode: { type: 'boolean' }
          },
          required: ['url']
        }
      }
    ]
  });
});

// --- Agent Skills Discovery (RFC v0.2.0) ------------------------------------
const SKILL_NAMES = [
  { name: 'link-preview', type: 'mcp-tool', description: 'Extract OG / Twitter / meta data from any URL.' },
  { name: 'take-screenshot', type: 'mcp-tool', description: 'Capture a screenshot of any public web page.' }
];

router.get('/agent-skills/index.json', (req, res) => {
  const skills = SKILL_NAMES.map(s => {
    const loaded = loadSkill(s.name);
    return {
      name: s.name,
      type: s.type,
      description: s.description,
      url: `${API_URL}/.well-known/agent-skills/${s.name}/SKILL.md`,
      sha256: loaded ? loaded.digest : null
    };
  }).filter(s => s.sha256);

  res.type('application/json').json({
    $schema: 'https://agentskills.io/schema/v0.2.0/agent-skills-index.json',
    version: '0.2.0',
    publisher: {
      name: 'WebIntel',
      url: SITE_URL
    },
    skills
  });
});

router.get('/agent-skills/:name/SKILL.md', (req, res) => {
  const loaded = loadSkill(req.params.name);
  if (!loaded) return res.status(404).type('text/plain').send('skill not found');
  res.type('text/markdown; charset=utf-8').send(loaded.body);
});

module.exports = router;
