const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { extname, resolve } = require('node:path');
const { chromium } = require('playwright');

const siteOrigin = 'http://sbuild.test';
const projectRoot = resolve(__dirname, '..');
const supabaseHost = 'nwwrxisppqarulclufaf.supabase.co';

function launchBrowser() {
  const proxy = process.env.BROWSER_TEST_PROXY;
  const spki = process.env.BROWSER_TEST_PROXY_SPKI;
  return chromium.launch({
    executablePath: process.env.BROWSER_TEST_CHROMIUM,
    proxy: proxy ? { server: proxy } : undefined,
    args: spki ? ['--ignore-certificate-errors-spki-list=' + spki] : [],
  });
}

async function openPage(browser, mockSupabase, contextOptions = {}) {
  const context = await browser.newContext({ ...contextOptions, serviceWorkers: 'block' });
  const seen = [];
  const unexpected = [];
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const { origin, hostname, pathname, searchParams } = url;

    if (origin === siteOrigin && method === 'GET' && /^\/(?:[\w-]+\.html|modules\/[\w-]+\.js|sbuild-config\.json)$/.test(pathname)) {
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
      const body = await readFile(resolve(projectRoot, '.' + pathname)).catch(() => null);
      return route.fulfill(body ? { contentType: types[extname(pathname)] + '; charset=utf-8', body } : { status: 404 });
    }
    if (origin === 'https://esm.sh' && method === 'GET') return route.continue();
    if (origin === 'https://images.unsplash.com' && request.resourceType() === 'image') return route.abort();
    if (origin === 'https://' + supabaseHost) {
      const body = request.postData() ? request.postDataJSON() : null;
      const mocked = mockSupabase({ method, pathname, searchParams, body });
      seen.push({ method, pathname, body });
      const headers = { 'access-control-allow-origin': siteOrigin };
      if (mocked) return route.fulfill({ status: mocked.status ?? 200, json: mocked.json, headers });
    }
    unexpected.push({ method, hostname, pathname });
    return route.abort();
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack));
  page.setDefaultTimeout(8000);
  return {
    context, page, seen, unexpected, errors,
    assertClean() {
      assert.deepEqual(unexpected, [], 'Unexpected network requests were blocked');
      assert.deepEqual(errors, [], 'Uncaught browser errors');
    },
  };
}

module.exports = { launchBrowser, openPage, siteOrigin };
