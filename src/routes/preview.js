/**
 * GET /v1/preview?url=https://example.com
 * 
 * Returns Open Graph, Twitter Card, and meta tag data for any URL.
 */

const express = require('express');
const router = express.Router();
const { getPreview } = require('../services/preview');

router.get('/', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({
      error: 'missing_url',
      message: 'Provide a URL via the ?url= query parameter.',
      example: '/v1/preview?url=https://example.com'
    });
  }

  try {
    const result = await getPreview(url);
    res.json({
      success: true,
      data: result
    });
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
