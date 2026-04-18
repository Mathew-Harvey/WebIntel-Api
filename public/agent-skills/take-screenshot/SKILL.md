---
name: take-screenshot
description: Capture a screenshot of any public web page via the WebIntel API.
version: 1.0.0
---

# take-screenshot

Use WebIntel's `/v1/screenshot` endpoint to capture PNG, JPEG, or WebP
screenshots of any public URL. Returns the image directly by default, or
base64 JSON with page metadata.

## When to use

- Visual verification of a page
- Generating thumbnails or social previews
- Capturing full-page scrolling screenshots for archival

## Endpoint

```
GET https://api.webintel.dev/v1/screenshot?url={url}
Header: x-api-key: wi_your_key
```

## Parameters

| Param      | Default | Notes                                 |
| ---------- | ------- | ------------------------------------- |
| `url`      | —       | Required. Fully qualified URL.        |
| `width`    | 1280    | Viewport width (max 1920).            |
| `height`   | 800     | Viewport height (max 1080).           |
| `format`   | png     | `png`, `jpeg`, or `webp`.             |
| `quality`  | 80      | 1-100 for jpeg/webp.                  |
| `fullPage` | false   | Capture the full scrollable page.     |
| `darkMode` | false   | Emulate `prefers-color-scheme: dark`. |
| `delay`    | 0       | Wait ms after load (max 5000).        |
| `response` | image   | `json` returns base64 + metadata.     |

## Example (image stream)

```bash
curl -H "x-api-key: wi_your_key" \
  "https://api.webintel.dev/v1/screenshot?url=https://github.com" \
  --output github.png
```

## Example (JSON for LLMs)

```bash
curl -H "x-api-key: wi_your_key" \
  "https://api.webintel.dev/v1/screenshot?url=https://github.com&response=json"
```

Response:

```json
{
  "success": true,
  "data": {
    "image": "data:image/png;base64,iVBORw0KGgo...",
    "title": "GitHub",
    "width": 1280,
    "height": 800,
    "format": "png",
    "sizeBytes": 184320
  }
}
```

## Authentication

Get a free key at <https://api.webintel.dev/api/signup>. Include it as
`x-api-key` on every request.

## Rate limits

- Free: 100 req/day
- Paid: 5,000 req/day
