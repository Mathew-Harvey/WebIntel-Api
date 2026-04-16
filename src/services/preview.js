/**
 * Link Preview Service
 * 
 * Fetches a URL and extracts:
 * - Open Graph tags (og:title, og:description, og:image, etc.)
 * - Twitter Card tags
 * - Standard meta tags (title, description, favicon)
 * - Site metadata (language, theme color, canonical URL)
 */

const cheerio = require('cheerio');
const { validateUrl } = require('../utils/validateUrl');

const TIMEOUT = parseInt(process.env.PREVIEW_TIMEOUT) || 10000;
const MAX_REDIRECTS = parseInt(process.env.MAX_REDIRECT_FOLLOWS) || 5;
const MAX_BODY_BYTES = parseInt(process.env.MAX_PREVIEW_BODY_BYTES) || 5 * 1024 * 1024; // 5 MB

const USER_AGENT = 'WebIntelBot/1.0 (+https://webintel.dev/bot)';

async function fetchWithRedirectLimit(url, maxRedirects) {
  let currentUrl = url;
  for (let i = 0; i <= maxRedirects; i++) {
    await validateUrl(currentUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT);

    let response;
    try {
      response = await fetch(currentUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        redirect: 'manual',
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw { status: 502, error: 'bad_redirect', message: 'Redirect without Location header' };
      }
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }

    return response;
  }

  throw { status: 502, error: 'too_many_redirects', message: `Exceeded ${maxRedirects} redirects` };
}

async function getPreview(url) {
  const startTime = Date.now();

  const parsedUrl = await validateUrl(url);

  let response;
  try {
    response = await fetchWithRedirectLimit(url, MAX_REDIRECTS);
  } catch (err) {
    if (err.status) throw err;
    if (err.name === 'AbortError') {
      throw { status: 504, error: 'timeout', message: `URL took longer than ${TIMEOUT}ms to respond` };
    }
    throw { status: 502, error: 'fetch_failed', message: `Could not reach ${parsedUrl.hostname}: ${err.message}` };
  }

  if (!response.ok) {
    const upstreamStatus = response.status;
    const mappedStatus = upstreamStatus === 404 ? 404 : (upstreamStatus >= 500 ? 502 : 502);
    throw {
      status: mappedStatus,
      error: upstreamStatus === 404 ? 'upstream_not_found' : 'upstream_error',
      message: `URL returned HTTP ${upstreamStatus}`
    };
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    // Non-HTML — return basic info
    return {
      url: response.url,
      title: null,
      description: null,
      image: null,
      favicon: null,
      siteName: parsedUrl.hostname,
      type: contentType.split(';')[0].trim(),
      language: null,
      themeColor: null,
      canonical: null,
      responseTime: Date.now() - startTime
    };
  }

  const contentLength = parseInt(response.headers.get('content-length'), 10);
  if (contentLength > MAX_BODY_BYTES) {
    throw { status: 502, error: 'body_too_large', message: `Response body exceeds ${MAX_BODY_BYTES} byte limit` };
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.length;
    if (totalBytes > MAX_BODY_BYTES) {
      reader.cancel();
      throw { status: 502, error: 'body_too_large', message: `Response body exceeds ${MAX_BODY_BYTES} byte limit` };
    }
    chunks.push(value);
  }
  const html = Buffer.concat(chunks).toString('utf-8');
  const $ = cheerio.load(html);

  // Helper to get meta content by property or name
  const meta = (attr) => {
    return $(`meta[property="${attr}"]`).attr('content')
      || $(`meta[name="${attr}"]`).attr('content')
      || null;
  };

  // Extract favicon
  let favicon = $('link[rel="icon"]').attr('href')
    || $('link[rel="shortcut icon"]').attr('href')
    || $('link[rel="apple-touch-icon"]').attr('href')
    || null;

  // Make favicon absolute
  if (favicon && !favicon.startsWith('http')) {
    try {
      favicon = new URL(favicon, response.url).href;
    } catch {
      favicon = `${parsedUrl.protocol}//${parsedUrl.host}/favicon.ico`;
    }
  }
  if (!favicon) {
    favicon = `${parsedUrl.protocol}//${parsedUrl.host}/favicon.ico`;
  }

  // Extract image and make absolute
  let image = meta('og:image') || meta('twitter:image') || null;
  if (image && !image.startsWith('http')) {
    try {
      image = new URL(image, response.url).href;
    } catch {
      image = null;
    }
  }

  // Build result
  const result = {
    url: response.url,
    title: meta('og:title') || meta('twitter:title') || $('title').first().text().trim() || null,
    description: meta('og:description') || meta('twitter:description') || meta('description') || null,
    image,
    favicon,
    siteName: meta('og:site_name') || parsedUrl.hostname,
    type: meta('og:type') || 'website',
    language: $('html').attr('lang') || meta('language') || null,
    themeColor: meta('theme-color') || null,
    canonical: $('link[rel="canonical"]').attr('href') || meta('og:url') || null,
    author: meta('author') || meta('article:author') || null,
    published: meta('article:published_time') || meta('date') || null,
    twitter: {
      card: meta('twitter:card') || null,
      site: meta('twitter:site') || null,
      creator: meta('twitter:creator') || null
    },
    responseTime: Date.now() - startTime
  };

  return result;
}

module.exports = { getPreview };
