const express = require('express');
const puppeteer = require('puppeteer');
const dotenv = require('dotenv');

dotenv.config();

const router = express.Router();

let browser;
let page;

router.get('/', async (req, res) => {
  const url = req.query.url;

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

module.exports = router;
