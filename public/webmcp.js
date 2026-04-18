/*
 * WebIntel WebMCP bootstrap
 *
 * Registers WebIntel's two tools with the browser via
 * `navigator.modelContext.provideContext()` so any page that loads this
 * script is immediately usable by WebMCP-aware AI agents.
 *
 *   <script src="https://api.webintel.dev/webmcp.js"
 *           data-api-base="https://api.webintel.dev"
 *           data-api-key=""></script>
 *
 * Docs: https://webmachinelearning.github.io/webmcp/
 */
(function () {
  if (typeof navigator === 'undefined') return;
  if (!navigator.modelContext || typeof navigator.modelContext.provideContext !== 'function') {
    return; // WebMCP not available in this browser.
  }

  var currentScript = document.currentScript;
  var apiBase = (currentScript && currentScript.dataset.apiBase) || 'https://api.webintel.dev';
  var apiKey = (currentScript && currentScript.dataset.apiKey) || '';

  function getKey() {
    if (apiKey) return apiKey;
    try {
      var stored = (localStorage.getItem('webintel:api-key') || '').trim();
      if (stored) return stored;
    } catch (_) { /* storage blocked */ }
    var node = document.getElementById('api-key-value');
    if (node && node.textContent) return node.textContent.trim();
    return '';
  }

  function headers() {
    var k = getKey();
    return k ? { 'x-api-key': k } : {};
  }

  async function linkPreview(args) {
    if (!args || !args.url) throw new Error('url is required');
    var res = await fetch(apiBase + '/v1/preview?url=' + encodeURIComponent(args.url), {
      headers: headers()
    });
    return await res.json();
  }

  async function takeScreenshot(args) {
    if (!args || !args.url) throw new Error('url is required');
    var params = new URLSearchParams();
    params.set('url', args.url);
    params.set('response', 'json');
    ['width', 'height', 'format', 'fullPage', 'darkMode', 'delay', 'quality'].forEach(function (k) {
      if (args[k] !== undefined && args[k] !== null) params.set(k, String(args[k]));
    });
    var res = await fetch(apiBase + '/v1/screenshot?' + params.toString(), {
      headers: headers()
    });
    return await res.json();
  }

  try {
    navigator.modelContext.provideContext({
      tools: [
        {
          name: 'link_preview',
          description:
            'Extract Open Graph, Twitter Card, and meta data (title, description, ' +
            'image, favicon, canonical, language) from any public URL via WebIntel.',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'Fully qualified URL to preview.' }
            },
            required: ['url']
          },
          execute: linkPreview
        },
        {
          name: 'take_screenshot',
          description:
            'Capture a PNG/JPEG/WebP screenshot of any public web page and return ' +
            'base64 image data plus page metadata (title, width, height, size).',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'Fully qualified URL to screenshot.' },
              width: { type: 'integer', description: 'Viewport width (max 1920).' },
              height: { type: 'integer', description: 'Viewport height (max 1080).' },
              format: { type: 'string', enum: ['png', 'jpeg', 'webp'] },
              quality: { type: 'integer', description: '1-100 (jpeg/webp only).' },
              fullPage: { type: 'boolean' },
              darkMode: { type: 'boolean' },
              delay: { type: 'integer', description: 'ms to wait after load (max 5000).' }
            },
            required: ['url']
          },
          execute: takeScreenshot
        }
      ]
    });
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[webintel-webmcp] provideContext failed:', err);
    }
  }
})();
