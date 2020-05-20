![logo](https://user-images.githubusercontent.com/795839/82451299-5ead7800-9ae0-11ea-9de9-cfa9760d9d63.png)

# pppr

![npm](https://img.shields.io/npm/v/pppr)

## Intro

pppr is a zero-configuration prerender service. If you develop a web via client-side rendering (such as Vue, Angular, React...), you can integrate Nginx (or other reverse proxy) and pppr for search engine crawler (such as googlebot, bingbot...) and social network (such as Facebook, Twitter...) to render complete HTML.

## Usage

```js
const pppr = require('pppr');

// ...some expressjs configurations

app.use(pppr());
```

## Installation

```sh
npm i pppr
```

## Configuration

### Cache (default is turn on)

```js
app.use(pppr());
```

equals to

```js
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

### Retry times

If it renders occur timeout, you can retry render again.

```js
app.use(pppr({
  retryTimes: 5 // Render timeout retry count (default is 5)
}));
```

### Endpoint

If endpoint conflicts, you can change it.

```js
app.use(pppr({
  endpoint: '/render' // Render endpoint (default is /render)
}));
```

## How-to

![server side rendering](https://user-images.githubusercontent.com/795839/82450244-0b86f580-9adf-11ea-9585-3b0224aae0de.jpg)

When Nginx received a request, it will check it is crawler or not. If it is crawler, it will forward to prerender service (such as pppr). Otherwise it will forward to web server.

## Lyrics

I have a page, I want to prerender it.

Ah, pppr.
