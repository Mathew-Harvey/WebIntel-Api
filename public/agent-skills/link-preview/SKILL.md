---
name: link-preview
description: Extract Open Graph, Twitter Card, and meta data from any public URL using the WebIntel API.
version: 1.0.0
---

# link-preview

Use WebIntel's `/v1/preview` endpoint to get structured metadata for a URL
(title, description, hero image, favicon, canonical, language, Twitter card,
etc.) without downloading or rendering the full page.

## When to use

- Summarising a link before showing it to a user
- Building link cards or rich previews
- Deduplicating / canonicalising URLs via `canonical`
- Detecting content language or publication metadata

## Endpoint

```
GET https://api.webintel.dev/v1/preview?url={url}
Header: x-api-key: wi_your_key
```

## Example

```bash
curl -H "x-api-key: wi_your_key" \
  "https://api.webintel.dev/v1/preview?url=https://example.com"
```

Response:

```json
{
  "success": true,
  "data": {
    "url": "https://example.com/",
    "title": "Example Domain",
    "description": "Example Domain",
    "image": null,
    "favicon": "https://example.com/favicon.ico",
    "canonical": "https://example.com/",
    "language": "en",
    "twitter": { "card": null, "site": null, "creator": null },
    "responseTime": 128
  }
}
```

## Authentication

Get a free key at <https://api.webintel.dev/api/signup>. Include it as
`x-api-key` on every request.

## Rate limits

- Free: 100 req/day
- Paid: 5,000 req/day

Rate limit state is returned in `RateLimit-*` response headers.
