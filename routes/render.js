const express = require('express');
const puppeteer = require('puppeteer');
const dotenv = require('dotenv');
const { ExtendExpressMethod } = require('../middlewares/extend-express-method');

dotenv.config();

const router = express.Router();

let browser;
let page;

router.use(ExtendExpressMethod);

router.get('/', async (req, res) => {
  const url = buildUrl(req.query);

  req.logd(`url: ${url}`);

  if (!browser) {
    browser = await puppeteer.launch({
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
  }

  const response = await page.goto(url, {
    waitUntil: 'networkidle2'
  });

  const request = response.request();

  if (!request) {
    return res.sendStatus(500);
  }

  const chain = request.redirectChain();

  // has redirect
  if (chain.length === 1) {
    const originalUrl = chain[0].url();
    const redirectUrl = chain[0]._frame._url;

    req.logd(`from ${originalUrl} to ${redirectUrl}`);

    return res.redirect(301, redirectUrl);
  }

  const content = await page.content();

  return res.send(content);
});

const buildUrl = query => {
  let url = query.url;

  delete query.url;

  const urlObj = new URL(url);

  const searchParams = new URLSearchParams(urlObj.searchParams.toString());

  Object.entries(query).forEach(entry => {
    searchParams.append(entry[0], entry[1]);
  });

  const querystring = searchParams.toString();

  url = urlObj.origin + urlObj.pathname;

  url = querystring ? url + '?' + querystring : url;

  return url;
};

module.exports = router;
