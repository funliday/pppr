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
 * @param {object} classOpts - Options
 * @param {(CacheConfig|boolean)} [classOpts.cache=true] - LRU cache options
 * @param {number} [classOpts.retryTimes=5] - Render timeout retry count
 * @param {string} [classOpts.executablePath] - Chromium executable binary path
 * @param {string} [classOpts.endpoint=/render] - Render endpoint
 * @param {string|Function} [classOpts.customUserAgent] - Render custom User-Agent
 * @param {UserAgentType} [classOpts.userAgentType] - Render User-Agent Type (default is UserAgentType.TYPE_HEADLESS)
 * @param {string[]} [classOpts.allowDomains] - Render allow domains
 * @param {beforeRenderCallback} [classOpts.beforeRender] - Callback before render
 * @param {afterRenderCallback} [classOpts.afterRender] - Callback after render
 */
const staticInstance = classOpts => {
  classOpts = decorateOptions(classOpts);

  const router = express.Router();

  let cache;

  if (classOpts.cache) {
    cache = new LRU(classOpts.cache);
  }

  let browser;
  let browserUserAgent;

  router.get(classOpts.endpoint, async (req, res) => {
    const { url, hostname } = buildUrl(req.query);

    console.log(`rendered url: ${url}`);

    const checkDomain = checkAllowDomains(hostname);

    if (!checkDomain) {
      return res.sendStatus(403);
    }

    const sourceUserAgent = req.headers['user-agent'];

    if (classOpts.beforeRender) {
      classOpts.beforeRender(sourceUserAgent, url);
    }

    let content;

    if (cache) {
      content = cache.get(url);

      if (content) {
        console.log(`[CACHE] Retrieve ${url}`);

        if (classOpts.afterRender) {
          classOpts.afterRender(sourceUserAgent, url, content);
        }

        return res.send(content);
      }
    }

    if (!browser) {
      browser = await launchBrowser();
    }

    if (classOpts.userAgentType === UserAgentType.TYPE_CUSTOM) {
      const typeCustomUserAgent = typeof classOpts.customUserAgent;

      browserUserAgent =
        typeCustomUserAgent === 'function'
          ? classOpts.customUserAgent(sourceUserAgent)
          : classOpts.customUserAgent;
    } else if (classOpts.userAgentType === UserAgentType.TYPE_SOURCE) {
      browserUserAgent = sourceUserAgent;
    } else if (classOpts.userAgentType === UserAgentType.TYPE_HEADLESS) {
      browserUserAgent = (await browser.userAgent()).replace(
        'HeadlessChrome',
        'Chrome'
      );
    }

    const page = await browser.newPage();

    await page._client.send('Network.clearBrowserCookies');

    await page.setExtraHTTPHeaders({
      'Accept-Language': req.headers['accept-language'] || ''
    });

    console.log(`user-agent: ${browserUserAgent}`);

    await page.setUserAgent(browserUserAgent);

    let response;

    for (let i = 0; i < classOpts.retryTimes; i++) {
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

        if (i === classOpts.retryTimes - 1) {
          await page.close();

          return res.sendStatus(500);
        }

        console.error(
          `Attempt to ${i + 1}/${
            classOpts.retryTimes
          } retries to retrieve ${url}`
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

    if (classOpts.afterRender) {
      classOpts.afterRender(browserUserAgent, url, content);
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
    classOpts.allowDomains.length === 0 ||
    !!classOpts.allowDomains.find(domain => domain === hostname);

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
    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    };

    if (classOpts.executablePath) {
      launchOptions.executablePath = classOpts.executablePath;
    }

    const browser = await puppeteer.launch(classOpts);

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
