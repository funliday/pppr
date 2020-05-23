<p align="center"><img width="100" src="https://raw.githubusercontent.com/funliday/pppr/master/assets/logo.png" alt="pppr logo"></a></p>

<p align="center">
  <a href="https://www.npmjs.com/package/pppr"><img src="https://img.shields.io/npm/v/pppr" alt="pppr version"></a>
  <a href="https://www.npmjs.com/package/pppr"><img src="https://img.shields.io/npm/dw/pppr" alt="pppr downloads"></a>
  <a href="https://www.npmjs.com/package/pppr"><img src="https://img.shields.io/npm/l/pppr" alt="pppr license"></a>
</p>

# pppr

pppr is a zero-configuration prerender service. If you develop a web via client-side rendering (such as Vue, Angular, React...), you can integrate Nginx (or other reverse proxy) and pppr for search engine crawler (such as googlebot, bingbot...) and social network (such as Facebook, Twitter...) to render complete HTML.

## Usage

```js
const pppr = require('pppr');

app.use(pppr());
```

## Installation

```sh
npm i pppr
```

## Configuration

### Nginx

[Configuration](https://gist.github.com/thoop/8165802)

### Cache (default is turn on)

```js
app.use(pppr());

// equals to

app.use(pppr({
  cache: true
}));
```

If you want to turn off cache, you can do below configuration.

```js
app.use(pppr({
  cache: false
}));
```

If you want to modify cache parameter, you can do below configuration.

```js
app.use(pppr({
  cache: {
    max: 50, // LRU cache entry max count (default is 50)
    maxAge: 300000 // LRU cache entry max age (milliseconds, default is 300000)
  }
}));
```

### Retry times (default is 5)

If it renders occur timeout, you can retry render again.

```js
app.use(pppr({
  retryTimes: 5
}));
```

### Endpoint (default is /render)

If endpoint conflicts, you can change it.

```js
app.use(pppr({
  endpoint: '/render'
}));
```

### Callback

If you want to do something before/after render, you can do below configuration.

```js
app.use(pppr({
  beforeRender: (userAgent, url) => {
    // do something
  },
  afterRender: (userAgent, url, content) => {
    // do something
  }
}))
```

## How-to

![server side rendering](https://user-images.githubusercontent.com/795839/82450244-0b86f580-9adf-11ea-9585-3b0224aae0de.jpg)

When Nginx received a request, it will check it is crawler or not. If it is crawler, it will forward to prerender service (such as pppr). Otherwise it will forward to web server.

## Lyrics

I have a page, I want to prerender it.

Ah, pppr.

## Inspired from

[prerender/prerender](https://github.com/prerender/prerender)
