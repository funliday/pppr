const express = require('express');
const puppeteer = require('puppeteer');
const LRU = require('lru-cache');

/**
 *
 * @param {object} [opts={}] Options
 * @param {(object|boolean)} [opts.cache=true] LRU cache options
 * @param {number} [opts.cache.max=50] - LRU cache entry max count
 * @param {number} [opts.cache.maxAge=300000] - LRU cache entry max age (milliseconds)
 * @param {number} [opts.retryTimes=5] Render timeout retry count
 * @param {string} [opts.endpoint="/render"] Render endpoint
 */
const staticInstance = opts => {
  opts = decorateOptions(opts);

  const router = express.Router();

  let cache;

  if (opts.cache) {
    cache = new LRU(opts.cache);
  }

  let browser;
  let browserUserAgent;

  router.get(opts.endpoint, async (req, res) => {
    const url = buildUrl(req.query);

    let content;

    if (cache) {
      content = cache.get(url);

      if (content) {
        console.log(`Retrieve ${url} via cache`);

        return res.send(content);
      }
    }

    if (!browser) {
      browser = await launchBrowser();

      browserUserAgent = (await browser.userAgent()).replace(
        'HeadlessChrome',
        'Chrome'
      );
    }

    const page = await browser.newPage();

    await page.setUserAgent(browserUserAgent);

    let response;

    for (let i = 0; i < opts.retryTimes; i++) {
      try {
        response = await page.goto(url, {
          waitUntil: 'networkidle2'
        });

        if (!response) {
          throw new Error('response is null');
        }

        break;
      } catch (error) {
        console.error(error);

        if (i === opts.retryTimes - 1) {
          await page.close();

          return res.sendStatus(500);
        }

        console.error(
          `Attempt to ${i + 1}/${opts.retryTimes} retries to retrieve ${url}`
        );
      }
    }

    const request = response.request();

    const chain = request.redirectChain();

    // has redirect
    if (chain.length === 1) {
      const redirectUrl = handleRedirect(chain);

      await page.close();

      return res.redirect(301, redirectUrl);
    }

    console.log(`Retrieve ${url} via headless chrome`);

    content = await page.content();

    if (cache) {
      cache.set(url, content);
    }

    await page.close();

    return res.send(content);
  });

  const buildUrl = query => {
    let url = query.url;

    delete query.url;

    const urlObj = new URL(url);

    const params = new URLSearchParams(urlObj.searchParams.toString());

    Object.entries(query).forEach(entry => {
      const key = entry[0];
      const value = entry[1];

      params.append(key, value);
    });

    const querystring = params.toString();

    url = urlObj.origin + urlObj.pathname;

    url = querystring ? url + '?' + querystring : url;

    return url;
  };

  const launchBrowser = async () => {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    return browser;
  };

  const handleRedirect = chain => {
    const originalUrl = chain[0].url();
    const redirectUrl = chain[0]._frame._url;

    console.log(`from ${originalUrl} to ${redirectUrl}`);

    return redirectUrl;
  };

  return router;
};

const decorateOptions = opts => {
  opts = opts || {};

  const typeCache = typeof opts.cache;

  if (typeCache === 'object' || typeCache === 'undefined') {
    opts.cache = opts.cache || {};
    opts.cache.max = opts.cache.max || 50;
    opts.cache.maxAge = opts.cache.maxAge || 1000 * 60 * 5;
  } else if (typeCache === 'boolean' && opts.cache) {
    opts.cache = {};
    opts.cache.max = opts.cache.max || 50;
    opts.cache.maxAge = opts.cache.maxAge || 1000 * 60 * 5;
  }

  opts.retryTimes = opts.retryTimes || 5;
  opts.endpoint = opts.endpoint || '/render';

  return opts;
};

module.exports = staticInstance;
