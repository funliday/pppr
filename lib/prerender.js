const express = require('express');
const PuppeteerCluster = require('puppeteer-cluster').Cluster;
const { LRUCache } = require('lru-cache');
const uuidv4 = require('uuid').v4;

/**
 * @callback beforeRenderCallback
 * @param {string} userAgent User agent
 * @param {string} url Render URL
 * @param {string} requestId Request ID
 */

/**
 * @callback afterRenderCallback
 * @param {string} userAgent User agent
 * @param {string} url Render URL
 * @param {string} content Render content
 * @param {string} requestId Request ID
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
 * @param {boolean} [classOpts.monitor=false] - Puppeteer cluster monitor
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
    opts.monitor = opts.monitor || false;
    opts.retryTimes = opts.retryTimes || 5;
    opts.endpoint = opts.endpoint || '/render';
    opts.userAgentType = opts.userAgentType || UserAgentType.TYPE_HEADLESS;
    opts.allowDomains = opts.allowDomains || [];

    return opts;
  };

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

    const checkDomain = checkAllowDomains(hostname);

    if (!checkDomain) {
      return res.sendStatus(403);
    }

    const sourceUserAgent = req.headers['user-agent'];

    const requestId = uuidv4();

    if (classOpts.beforeRender) {
      classOpts.beforeRender(sourceUserAgent, url, requestId);
    }

    let pageContent;

    if (cache) {
      pageContent = cache.get(url);

      if (pageContent) {
        console.log(`[CACHE] Retrieve ${url}`);

        if (classOpts.afterRender) {
          classOpts.afterRender(sourceUserAgent, url, pageContent, requestId);
        }

        return res.send(pageContent);
      }
    }

    if (!browserCluster) {
      browserCluster = await launchCluster();

      browserCluster.on('taskerror', (err, data) => {
        console.error(`[PUPPETEER-CLUSTER] ${data}: ${err}`);
      });
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

    const loadPage = async ({ page, data: { url, requestId } }) => {
      console.log(`rendered url: ${url}`);

      await page.setExtraHTTPHeaders({
        'Accept-Language': req.headers['accept-language'] || ''
      });

      await page.setUserAgent(browserUserAgent);

      let response;

      try {
        response = await page.goto(url, {
          waitUntil: 'networkidle2'
        });

        const chain = response.request().redirectChain();

        if (chain.length !== 0) {
          const { statusCode, redirectUrl } = handleRedirect(chain);

          return {
            res,
            url,
            status: statusCode,
            redirectUrl,
            requestId
          };
        }

        if (!response) {
          throw new Error('response is null');
        }
      } catch (error) {
        console.error(`[PUPPETEER-CLUSTER] ${url} ${error}`);

        return {
          res,
          url,
          status: 500,
          requestId
        };
      }

      const content = await page.content();

      console.log(`[PUPPETEER-CLUSTER] Retrieve ${url}`);

      return {
        res,
        url,
        status: response.status(),
        content,
        requestId
      };
    };

    console.log(`queue url: ${url}`);

    const clusterResponse = await browserCluster.execute(
      {
        url,
        requestId
      },
      loadPage
    );

    return pageResponse(clusterResponse);
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

  const handleRedirect = chain => {
    const originalUrl = chain[0].url();
    const redirectUrl = chain[0].frame().url();
    const statusCode = chain[0].response().status();

    console.log(`from ${originalUrl} ${statusCode} to ${redirectUrl}`);

    return {
      statusCode,
      redirectUrl
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

  const pageResponse = ({
    res,
    url,
    status,
    content,
    redirectUrl,
    requestId
  }) => {
    if (classOpts.afterRender) {
      classOpts.afterRender(browserUserAgent, url, content, requestId);
    }

    if (redirectUrl) {
      return res.redirect(status, redirectUrl);
    } else {
      if (status >= 200 && status < 300) {
        if (cache) {
          cache.set(url, content);
        }

        return res.status(status).send(content);
      } else {
        return res.sendStatus(status);
      }
    }
  };

  return router;
};

module.exports = staticInstance;
