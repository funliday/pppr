const prerender = require('prerender');
const memoryCache = require('prerender-memory-cache');

const server = prerender({
  chromeLocation: '/app/.apt/usr/bin/google-chrome'
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
