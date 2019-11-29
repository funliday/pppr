const prerender = require('prerender');
const server = prerender({
  chromeLocation: '/app/.apt/usr/bin/google-chrome'
});

server.start();
