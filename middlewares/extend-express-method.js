const winston = require('winston');

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

const logger = winston.createLogger({
  format: logFormat,
  defaultMeta: { service: 'user-service' },
  transports: [
    new winston.transports.Console({
      level: 'debug'
    })
  ]
});

function ExtendExpressMethod(req, res, next) {
  const buildLogMessage = (accessToken, msg) =>
    `[${new Date().toISOString()}] ${msg}`;

  req.logi = msg => {
    logger.info(buildLogMessage(req.logAccessToken, msg));
  };

  req.logd = msg => {
    logger.debug(buildLogMessage(req.logAccessToken, msg));
  };

  req.loge = msg => {
    logger.error(buildLogMessage(req.logAccessToken, msg));
  };

  next();
}

module.exports = { ExtendExpressMethod };
