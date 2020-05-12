const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const winston = require('winston');
const expressWinston = require('express-winston');

const renderRouter = require('./routes/render');

const app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.disable('x-powered-by');

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

const customLogFormat = winston.format.printf(
  info => `${info.level}: ${info.message}`
);

const logFormat = winston.format.combine(
  winston.format(info => {
    info.level = info.level.toUpperCase();

    return info;
  })(),
  winston.format.colorize(),
  customLogFormat
);

expressWinston.responseWhitelist.push('body');

app.use(
  expressWinston.logger({
    transports: [new winston.transports.Console()],
    msg: (req, res) => {
      let code = '-';

      if (res.statusCode === 200 && res.body) {
        code = res.body.code || '-';
      }

      const contentLength = res._contentLength ? res._contentLength : '-';

      return `[${new Date().toISOString()}] "${req.method} ${req.url}" ${
        res.statusCode
      } ${code} ${contentLength} - ${res.responseTime} ms "${
        req.headers['user-agent']
      }"`;
    },
    format: logFormat
  })
);

app.use('/render', renderRouter);

// catch 404 and forward to error handler
app.use((req, res, next) => next(createError(404)));

// error handler
app.use((err, req, res, next) => {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
