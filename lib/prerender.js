const express = require('express');
const puppeteer = require('puppeteer');
const LRU = require('lru-cache');

/**
 * @callback beforeRenderCallback
 * @param {string} userAgent User agent
 * @param {string} url Render URL
 */

/**
 * @callback afterRenderCallback
 * @param {string} userAgent User agent
 * @param {string} url Render URL
 * @param {string} content Render content
 */

/**
 * @typedef CacheConfig
 * @type {object}
 * @property {number} [max=50] - LRU cache entry max count
 * @property {number} [maxAge=300000] - LRU cache entry max age (milliseconds)
 */

/**
 * Enum for UserAgentType
 *
 * @readonly
 * @enum {number}
 */
const UserAgentType = {
  TYPE_CUSTOM: 1,
  TYPE_SOURCE: 2,
  TYPE_HEADLESS: 3
};

/**
 * @param {object} opts - Options
 * @param {(CacheConfig|boolean)} [opts.cache=true] - LRU cache options
 * @param {number} [opts.retryTimes=5] - Render timeout retry count
 * @param {string} [opts.endpoint=/render] - Render endpoint
 * @param {string} [opts.customUserAgent] - Render custom User-Agent
 * @param {UserAgentType} [opts.userAgentType] - Render User-Agent Type (default is UserAgentType.TYPE_HEADLESS)
 * @param {beforeRenderCallback} [opts.beforeRender] - Callback before render
 * @param {afterRenderCallback} [opts.afterRender] - Callback after render
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
    const sourceUserAgent = req.headers['user-agent'];

    if (opts.beforeRender) {
      opts.beforeRender(sourceUserAgent, url);
    }

    let content;

    if (cache) {
      content = cache.get(url);

      if (content) {
        console.log(`[CACHE] Retrieve ${url}`);

        if (opts.afterRender) {
          opts.afterRender(sourceUserAgent, url, content);
        }

        return res.send(content);
      }
    }

    console.log('LOG 1');

    if (!browser) {
      console.log('LOG 2');

      browser = await launchBrowser();

      console.log('LOG 3');

      browser
        .on('disconnected', () => {
          console.log('disconnected');
        })
        .on('targetcreated', async (e, args) => {
          console.log(`targetcreated ${e.url()}`);
        })
        .on('targetchanged', async (e, args) => {
          console.log(`targetchanged ${e.url()}`);
        })
        .on('targetdestroyed', async (e, args) => {
          console.log(`targetdestroyed ${e.url()}`);
        });

      browserUserAgent = (await browser.userAgent()).replace(
        'HeadlessChrome',
        'Chrome'
      );

      console.log('LOG 31');

      if (opts.userAgentType === UserAgentType.TYPE_CUSTOM) {
        browserUserAgent = opts.customUserAgent;
      }

      console.log('LOG 32');
    }

    console.log('LOG 4');

    if (opts.userAgentType === UserAgentType.TYPE_SOURCE) {
      browserUserAgent = sourceUserAgent;
    }

    console.log('LOG 5');

    const page = await browser.newPage();

    console.log('LOG 6');

    await page.setExtraHTTPHeaders({
      'Accept-Language': req.headers['accept-language'] || ''
    });

    console.log('LOG 7');

    console.log(`user-agent: ${browserUserAgent}`);

    await page.setUserAgent(browserUserAgent);

    console.log('LOG 8');

    let response;

    for (let i = 0; i < opts.retryTimes; i++) {
      try {
        console.log('LOG 9');

        response = await page.goto(url, {
          waitUntil: 'networkidle2'
        });

        console.log('LOG 10');

        if (!response) {
          throw new Error('response is null');
        }

        console.log('LOG 11');

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

    console.log('LOG 12');

    const request = response.request();

    console.log('LOG 13');

    const chain = request.redirectChain();

    console.log('LOG 14');

    // has redirect
    if (chain.length === 1) {
      console.log('LOG 15');

      const { statusCode, redirectUrl } = handleRedirect(chain);

      console.log('LOG 16');

      await page.close();

      console.log('LOG 17');

      return res.redirect(statusCode, redirectUrl);
    }

    console.log('LOG 18');

    content = await page.content();

    console.log('LOG 19');

    console.log(`[PUPPETEER] Retrieve ${url}`);

    if (opts.afterRender) {
      opts.afterRender(browserUserAgent, url, content);
    }

    console.log('LOG 20');

    if (cache) {
      cache.set(url, content);
    }

    console.log('LOG 21');

    const { cookies } = await page._client.send('Network.getAllCookies');

    console.log('LOG 22');

    await page.close();

    console.log('LOG 23');

    cookies.forEach(cookie => {
      res.cookie(cookie.name, cookie.value);
    });

    console.log('LOG 24');

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
    const statusCode = chain[0]._response._status;

    console.log(`from ${originalUrl} ${statusCode} to ${redirectUrl}`);

    return {
      statusCode,
      redirectUrl
    };
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
  opts.userAgentType = opts.userAgentType || UserAgentType.TYPE_HEADLESS;

  return opts;
};

module.exports = staticInstance;
