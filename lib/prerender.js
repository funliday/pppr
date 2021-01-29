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
 * @param {string|Function} [opts.customUserAgent] - Render custom User-Agent
 * @param {UserAgentType} [opts.userAgentType] - Render User-Agent Type (default is UserAgentType.TYPE_HEADLESS)
 * @param {string[]} [opts.allowDomains] - Render allow domains
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
    const { url, hostname } = buildUrl(req.query);

    const checkDomain = checkAllowDomains(hostname);

    if (!checkDomain) {
      return res.sendStatus(403);
    }

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

    if (!browser) {
      browser = await launchBrowser();
    }

    if (opts.userAgentType === UserAgentType.TYPE_CUSTOM) {
      const typeCustomUserAgent = typeof opts.customUserAgent;

      browserUserAgent =
        typeCustomUserAgent === 'function'
          ? opts.customUserAgent(sourceUserAgent)
          : opts.customUserAgent;
    } else if (opts.userAgentType === UserAgentType.TYPE_SOURCE) {
      browserUserAgent = sourceUserAgent;
    } else if (opts.userAgentType === UserAgentType.TYPE_HEADLESS) {
      browserUserAgent = (await browser.userAgent()).replace(
        'HeadlessChrome',
        'Chrome'
      );
    }

    const page = await browser.newPage();

    await page.setExtraHTTPHeaders({
      'Accept-Language': req.headers['accept-language'] || ''
    });

    console.log(`user-agent: ${browserUserAgent}`);

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
      const { statusCode, redirectUrl } = handleRedirect(chain);

      await page.close();

      return res.redirect(statusCode, redirectUrl);
    }

    content = await page.content();

    console.log(`[PUPPETEER] Retrieve ${url}`);

    if (opts.afterRender) {
      opts.afterRender(browserUserAgent, url, content);
    }

    if (cache) {
      cache.set(url, content);
    }

    const { cookies } = await page._client.send('Network.getAllCookies');

    await page.close();

    cookies.forEach(cookie => {
      res.cookie(cookie.name, decodeURIComponent(cookie.value));
    });

    return res.send(content);
  });

  const checkAllowDomains = hostname =>
    opts.allowDomains.length === 0 ||
    !!opts.allowDomains.find(domain => domain === hostname);

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

    return {
      url,
      hostname: urlObj.hostname
    };
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
  opts.allowDomains = opts.allowDomains || [];

  return opts;
};

module.exports = staticInstance;
