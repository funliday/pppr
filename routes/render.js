const express = require('express');
const puppeteer = require('puppeteer');
const dotenv = require('dotenv');
const LRU = require('lru-cache');
const { Pool } = require('pg');
const { ExtendExpressMethod } = require('../middlewares/extend-express-method');

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  application_name: 'funliday-prerender'
});

const cache = new LRU({
  max: 50,
  maxAge: 1000 * 60 * 5 // 5 mins
});

const QueryString = {
  INSERT_HISTORY: `
INSERT INTO prerender_history (url, language, user_agent)
  VALUES ($1, $2, $3)
  `
};

const RETRY_TIMES = 5;

const router = express.Router();

let browser;
let page;

router.use(ExtendExpressMethod);

router.get('/', async (req, res) => {
  const { url, language } = buildUrl(req.query);
  const ua = req.headers['user-agent'];

  await pool.query(QueryString.INSERT_HISTORY, [url, language, ua]);

  let content = cache.get(url);

  if (content) {
    req.logi(`Retrieve ${url} via cache`);

    return res.send(content);
  }

  if (!browser) {
    browser = await launchBrowser();
  }

  let response;

  for (let i = 0; i < RETRY_TIMES; i++) {
    try {
      response = await page.goto(url, {
        waitUntil: 'networkidle2'
      });

      if (!response) {
        throw new Error('response is null');
      }

      break;
    } catch (error) {
      req.loge(error);

      if (i === RETRY_TIMES - 1) {
        return res.sendStatus(500);
      }

      req.loge(`Attempt to ${i + 1}/${RETRY_TIMES} retries to retrieve ${url}`);
    }
  }

  const request = response.request();

  const chain = request.redirectChain();

  // has redirect
  if (chain.length === 1) {
    const redirectUrl = handleRedirect(chain, req.logd);

    return res.redirect(301, redirectUrl);
  }

  req.logi(`Retrieve ${url} via headless chrome`);

  content = await page.content();

  cache.set(url, content);

  return res.send(content);
});

const buildUrl = query => {
  let url = query.url;

  delete query.url;

  const urlObj = new URL(url);

  const searchParams = new URLSearchParams(urlObj.searchParams.toString());

  Object.entries(query).forEach(entry => {
    const key = entry[0];
    const value = entry[1];

    searchParams.append(key, value);
  });

  const language = searchParams.get('hl');

  const querystring = searchParams.toString();

  url = urlObj.origin + urlObj.pathname;

  url = querystring ? url + '?' + querystring : url;

  return {
    url,
    language
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

  const userAgent = (await browser.userAgent()).replace(
    'HeadlessChrome',
    'Chrome'
  );

  page = await browser.newPage();

  await page.setUserAgent(userAgent);

  return browser;
};

const handleRedirect = (chain, logger) => {
  const originalUrl = chain[0].url();
  const redirectUrl = chain[0]._frame._url;

  logger(`from ${originalUrl} to ${redirectUrl}`);

  return redirectUrl;
};

module.exports = router;
