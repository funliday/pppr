const prerender = require('prerender');
const memoryCache = require('prerender-memory-cache');
const dotenv = require('dotenv');

dotenv.config();

const server = prerender({
  chromeLocation: '/app/.apt/usr/bin/google-chrome',
  waitAfterLastRequest: +process.env.PRERENDER_WAIT_AFTER_LAST_REQUEST
});

const ShowUserAgent = {
  init: () => {},

  beforeSend: (req, res, next) => {
    console.log(
      `${new Date().toISOString()} user-agent: ${
        req.headers['user-agent']
      } for ${req.prerender.url}`
    );

    next();
  }
};

server.use(ShowUserAgent);
server.use(memoryCache);

server.start();
