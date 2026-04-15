/**
 * GET /v1/screenshot?url=https://example.com
 * 
 * Query params:
 *   url       (required) - URL to capture
 *   width     (optional) - viewport width, default 1280, max 1920
 *   height    (optional) - viewport height, default 800, max 1080
 *   format    (optional) - png | jpeg | webp, default png
 *   quality   (optional) - 1-100 for jpeg/webp, default 80
 *   fullPage  (optional) - true to capture full scrollable page
 *   darkMode  (optional) - true to emulate dark mode
 *   delay     (optional) - ms to wait after load, max 5000
 *   response  (optional) - "json" to get base64 + metadata, default streams image
 */

const express = require('express');
const router = express.Router();
const { takeScreenshot } = require('../services/screenshot');

router.get('/', async (req, res) => {
  const { url, width, height, format, quality, fullPage, darkMode, delay, response } = req.query;

  if (!url) {
    return res.status(400).json({
      error: 'missing_url',
      message: 'Provide a URL via the ?url= query parameter.',
      example: '/v1/screenshot?url=https://example.com&width=1280&format=png'
    });
  }

  try {
    const result = await takeScreenshot(url, {
      width, height, format, quality, fullPage, darkMode, delay
    });

    // JSON response with base64 (useful for LLMs / MCP)
    if (response === 'json') {
      return res.json({
        success: true,
        data: {
          ...result.metadata,
          image: `data:image/${result.metadata.format};base64,${result.buffer.toString('base64')}`
        }
      });
    }

    // Default: stream the image directly
    const mimeType = `image/${result.metadata.format}`;
    res.set({
      'Content-Type': mimeType,
      'Content-Length': result.metadata.sizeBytes,
      'X-Screenshot-Width': result.metadata.width,
      'X-Screenshot-Height': result.metadata.height,
      'X-Response-Time': `${result.metadata.responseTime}ms`,
      'Cache-Control': 'public, max-age=3600'
    });
    res.send(result.buffer);

  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      error: err.error || 'internal_error',
      message: err.message || 'Something went wrong'
    });
  }
});

module.exports = router;
