# WebIntel API

Link Preview & Screenshot API — served as both a REST API and an MCP server for LLMs.

## Endpoints

### `GET /v1/preview?url={url}`

Extract Open Graph, Twitter Card, and meta data from any URL.

```bash
curl -H "x-api-key: wi_your_key" \
  "https://your-app.onrender.com/v1/preview?url=https://abc.net.au"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "url": "https://www.abc.net.au/",
    "title": "ABC News",
    "description": "Australia's most trusted source of local, national and world news.",
    "image": "https://www.abc.net.au/res/abc/img/abc-og.png",
    "favicon": "https://www.abc.net.au/favicon.ico",
    "siteName": "ABC News",
    "type": "website",
    "language": "en",
    "themeColor": "#000000",
    "canonical": "https://www.abc.net.au/",
    "author": null,
    "published": null,
    "twitter": {
      "card": "summary_large_image",
      "site": "@abcnews",
      "creator": null
    },
    "responseTime": 342
  }
}
```

---

### `GET /v1/screenshot?url={url}`

Capture a screenshot of any web page. Returns the image directly (default) or as JSON with base64.

| Param      | Default | Description                           |
| ---------- | ------- | ------------------------------------- |
| `url`      | —       | URL to capture (required)             |
| `width`    | 1280    | Viewport width, max 1920              |
| `height`   | 800     | Viewport height, max 1080             |
| `format`   | png     | `png`, `jpeg`, or `webp`              |
| `quality`  | 80      | 1-100 for jpeg/webp                   |
| `fullPage` | false   | Capture full scrollable page          |
| `darkMode` | false   | Emulate dark mode                     |
| `delay`    | 0       | Wait ms after load (max 5000)         |
| `response` | image   | Set to `json` for base64 + metadata   |

```bash
# Stream image directly (e.g. embed in <img> tag)
curl -H "x-api-key: wi_your_key" \
  "https://your-app.onrender.com/v1/screenshot?url=https://github.com" \
  --output github.png

# Get JSON with base64 (useful for LLMs / programmatic use)
curl -H "x-api-key: wi_your_key" \
  "https://your-app.onrender.com/v1/screenshot?url=https://github.com&response=json"
```

---

## Authentication

Include your API key in every request:

```
Header:  x-api-key: wi_your_key_here
   OR
Query:   ?api_key=wi_your_key_here
```

## Rate Limits

| Tier | Limit         | Price    |
| ---- | ------------- | -------- |
| Free | 100 req/day   | $0       |
| Paid | 5,000 req/day | $9/month |

Rate limit headers are included in every response (`RateLimit-*`).

---

## MCP Server (for Claude / LLMs)

The MCP server wraps the REST API so Claude and other LLMs can call
`link_preview` and `take_screenshot` as native tools.

### Setup for Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "webintel": {
      "command": "node",
      "args": ["/absolute/path/to/webintel-api/mcp/server.js"],
      "env": {
        "WEBINTEL_API_KEY": "wi_your_key_here",
        "WEBINTEL_BASE_URL": "https://your-app.onrender.com"
      }
    }
  }
}
```

### Available MCP Tools

**`link_preview`** — Extract OG/meta data from a URL
```json
{ "url": "https://example.com" }
```

**`take_screenshot`** — Capture a screenshot of a URL
```json
{
  "url": "https://example.com",
  "width": 1280,
  "format": "png",
  "fullPage": false,
  "darkMode": true
}
```

---

## Deploy to Render

1. Push to GitHub
2. Connect repo in Render dashboard
3. Select "Docker" runtime
4. Set environment variables:
   - `API_KEYS` — comma-separated list of valid keys
   - `NODE_ENV` — `production`
5. Use **Starter** plan ($7/month) — Puppeteer needs the memory

Or use the `render.yaml` blueprint for one-click deploy.

---

## Local Development

```bash
# Clone and install
git clone https://github.com/Mathew-Harvey/webintel-api.git
cd webintel-api
npm install

# Copy env
cp .env.example .env

# Run
npm run dev

# Test preview
curl -H "x-api-key: wi_test_abc123" \
  "http://localhost:3000/v1/preview?url=https://example.com"

# Test screenshot
curl -H "x-api-key: wi_test_abc123" \
  "http://localhost:3000/v1/screenshot?url=https://example.com" \
  --output test.png
```

---

## Project Structure

```
webintel-api/
├── src/
│   ├── server.js              # Express entry point
│   ├── middleware/
│   │   ├── auth.js            # API key authentication
│   │   └── rateLimit.js       # Tier-aware rate limiting
│   ├── routes/
│   │   ├── preview.js         # /v1/preview handler
│   │   └── screenshot.js      # /v1/screenshot handler
│   └── services/
│       ├── preview.js         # HTML fetch + OG parsing
│       └── screenshot.js      # Puppeteer screenshot capture
├── mcp/
│   └── server.js              # MCP server wrapper for LLMs
├── Dockerfile                 # Production build with Chromium
├── render.yaml                # Render deploy config
├── package.json
└── .env.example
```

## Agent-readiness

WebIntel publishes the discovery resources AI agents look for. They are all
served from `api.webintel.dev` (and can be mirrored or proxied from
`webintel.dev` — see note below).

| Path                                                      | Purpose                                      |
| --------------------------------------------------------- | -------------------------------------------- |
| `/robots.txt`                                             | Crawl rules + AI bot rules + Content-Signal  |
| `/sitemap.xml`                                            | Canonical URL index                          |
| `/openapi.json`                                           | OpenAPI 3.1 service description              |
| `/.well-known/api-catalog`                                | RFC 9727 linkset for the API                 |
| `/.well-known/oauth-protected-resource`                   | RFC 9728 resource metadata                   |
| `/.well-known/oauth-authorization-server`                 | RFC 8414 issuer metadata                     |
| `/.well-known/mcp/server-card.json`                       | SEP-1649 MCP server card                     |
| `/.well-known/agent-skills/index.json`                    | Agent Skills Discovery RFC v0.2.0 index      |
| `/.well-known/agent-skills/<skill>/SKILL.md`              | Individual skill definitions                 |
| `/.well-known/http-message-signatures-directory`          | Web Bot Auth Ed25519 JWKS (RFC 9421 signed)  |
| `/webmcp.js`                                              | Drop-in WebMCP bootstrap for the landing page|

The homepage (`/`) also:

- Sends RFC 8288 `Link` headers pointing at the above resources.
- Supports Markdown content negotiation — `Accept: text/markdown` returns a
  plain-text summary of the API.

The dashboard page exposes `link_preview` and `take_screenshot` via the
experimental [WebMCP](https://webmachinelearning.github.io/webmcp/) API
(`navigator.modelContext.provideContext`).

`public/webmcp.js` is the standalone bootstrap — drop this into the landing
page and any WebMCP-capable browser will see the tools:

```html
<script src="https://api.webintel.dev/webmcp.js"
        data-api-base="https://api.webintel.dev"></script>
```

### Web Bot Auth key

`/.well-known/http-message-signatures-directory` publishes an Ed25519 JWKS
and signs its response per [RFC 9421](https://www.rfc-editor.org/rfc/rfc9421)
with `tag="http-message-signatures-directory"`.

For a stable key across restarts, set:

```
WEB_BOT_AUTH_ED25519_PRIVATE_KEY_PEM=<PKCS#8 PEM>
```

Generate one with:

```
openssl genpkey -algorithm ED25519 -out webintel-webbotauth.pem
```

If unset, an ephemeral key is generated on boot (dev only — the directory's
`keyid` will change on every restart).

### Mirroring to webintel.dev

The `isitagentready.com` scanner checks the bare apex (e.g. `webintel.dev`).
To pick up the same signals there, either:

1. Configure the Cloudflare CDN in front of `webintel.dev` to proxy
   `/robots.txt`, `/sitemap.xml`, `/openapi.json`, and `/.well-known/*` to
   `api.webintel.dev`, **or**
2. Copy `public/robots.txt`, `public/sitemap.xml`, `public/openapi.json`, and
   `public/agent-skills/` into the landing-page repo and add the well-known
   routes there too.

## Roadmap

- [ ] PostgreSQL key management + Stripe billing
- [ ] Redis rate limiting for multi-instance
- [ ] `/v1/techstack` endpoint
- [ ] `/v1/whois` endpoint
- [ ] Publish MCP server to registry
- [ ] Landing page + docs site

## License

MIT
