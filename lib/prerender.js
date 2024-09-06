const express = require('express');
const PuppeteerCluster = require('puppeteer-cluster').Cluster;
const { LRUCache } = require('lru-cache');

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
 * @property {number} [ttl=300000] - LRU cache entry max age (milliseconds)
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
 * @param {number} [classOpts.maxConcurrency=2] - Puppeteer cluster max concurrency
 * @param {boolean} [classOpts.monitor=true] - Puppeteer cluster monitor
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
    cache = new LRUCache(classOpts.cache);
  }

  let browserCluster;
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

    if (!browserCluster) {
      browserCluster = await launchCluster();
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
      browserUserAgent =
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
    }

    content = await browserCluster.execute(null, async ({ page }) => {
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

      const content = await page.content();

      console.log(`[PUPPETEER-CLUSTER] Retrieve ${url}`);

      if (classOpts.afterRender) {
        classOpts.afterRender(browserUserAgent, url, content);
      }

      return content;
    });

    if (cache) {
      cache.set(url, content);
    }

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

  const launchCluster = async () => {
    const launchOptions = {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ],
      headless: true,
      dumpio: true
    };

    if (classOpts.executablePath) {
      launchOptions.executablePath = classOpts.executablePath;
    }

    const cluster = await PuppeteerCluster.launch({
      concurrency: PuppeteerCluster.CONCURRENCY_CONTEXT,
      maxConcurrency: classOpts.maxConcurrency,
      monitor: classOpts.monitor,
      puppeteerOptions: launchOptions
    });

    return cluster;
  };

  return router;
};

const decorateOptions = opts => {
  opts = opts || {};

  const typeCache = typeof opts.cache;

  if (typeCache === 'object' || typeCache === 'undefined') {
    opts.cache = opts.cache || {};
    opts.cache.max = opts.cache.max || 50;
    opts.cache.ttl = opts.cache.ttl || 1000 * 60 * 5;
  } else if (typeCache === 'boolean' && opts.cache) {
    opts.cache = {};
    opts.cache.max = opts.cache.max || 50;
    opts.cache.ttl = opts.cache.ttl || 1000 * 60 * 5;
  }

  opts.maxConcurrency = opts.maxConcurrency || 2;
  opts.monitor = opts.monitor || true;
  opts.retryTimes = opts.retryTimes || 5;
  opts.endpoint = opts.endpoint || '/render';
  opts.userAgentType = opts.userAgentType || UserAgentType.TYPE_HEADLESS;
  opts.allowDomains = opts.allowDomains || [];

  return opts;
};

module.exports = staticInstance;
