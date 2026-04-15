/**
 * Screenshot Service
 * 
 * Uses Puppeteer to capture full-page or viewport screenshots.
 * Returns PNG or JPEG buffer + metadata.
 * 
 * Manages a browser pool to avoid cold starts on every request.
 */

const puppeteer = require('puppeteer');
const { validateUrl } = require('../utils/validateUrl');

const TIMEOUT = parseInt(process.env.SCREENSHOT_TIMEOUT) || 15000;
const MAX_WIDTH = parseInt(process.env.MAX_SCREENSHOT_WIDTH) || 1920;
const MAX_HEIGHT = parseInt(process.env.MAX_SCREENSHOT_HEIGHT) || 1080;

let browser = null;
let launchPromise = null;

async function getBrowser() {
  if (browser && browser.connected) return browser;

  if (launchPromise) return launchPromise;

  launchPromise = puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer'
    ]
  }).then(instance => {
    browser = instance;
    launchPromise = null;
    console.log('[screenshot] Browser launched');
    return browser;
  }).catch(err => {
    launchPromise = null;
    throw err;
  });

  return launchPromise;
}

async function takeScreenshot(url, options = {}) {
  const startTime = Date.now();

  await validateUrl(url);

  // Parse options with sensible defaults
  const width = Math.min(parseInt(options.width) || 1280, MAX_WIDTH);
  const height = Math.min(parseInt(options.height) || 800, MAX_HEIGHT);
  const fullPage = options.fullPage === 'true' || options.fullPage === true;
  const format = ['png', 'jpeg', 'webp'].includes(options.format) ? options.format : 'png';
  const quality = format === 'png' ? undefined : Math.min(parseInt(options.quality) || 80, 100);
  const darkMode = options.darkMode === 'true' || options.darkMode === true;
  const delay = Math.min(parseInt(options.delay) || 0, 5000); // max 5s delay

  let page;
  try {
    const browserInstance = await getBrowser();
    page = await browserInstance.newPage();

    // Set viewport
    await page.setViewport({ width, height, deviceScaleFactor: 1 });

    // Dark mode
    if (darkMode) {
      await page.emulateMediaFeatures([
        { name: 'prefers-color-scheme', value: 'dark' }
      ]);
    }

    // Block unnecessary resources for speed
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['media', 'font'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Navigate
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: TIMEOUT
    });

    // Optional delay (wait for animations, lazy-loaded content)
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Capture
    const screenshotData = await page.screenshot({
      type: format,
      quality,
      fullPage,
      encoding: 'binary'
    });
    const screenshotBuffer = Buffer.from(screenshotData);

    // Get page title for metadata
    const pageTitle = await page.title();

    return {
      buffer: screenshotBuffer,
      metadata: {
        url: page.url(),
        title: pageTitle,
        width,
        height,
        fullPage,
        format,
        sizeBytes: screenshotBuffer.length,
        responseTime: Date.now() - startTime
      }
    };

  } catch (err) {
    if (err.status) throw err; // Already formatted
    if (err.name === 'TimeoutError') {
      throw { status: 504, error: 'timeout', message: `Page took longer than ${TIMEOUT}ms to load` };
    }
    throw { status: 502, error: 'screenshot_failed', message: err.message };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

module.exports = { takeScreenshot, closeBrowser };
