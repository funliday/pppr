const prerender = require('prerender');
const memoryCache = require('prerender-memory-cache');

const server = prerender({
  chromeLocation: '/app/.apt/usr/bin/google-chrome'
});

server.use(memoryCache);

server.start();
