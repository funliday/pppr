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

  await page.goto(url, {
    waitUntil: 'networkidle2'
  });

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
