const winston = require('winston');
const config = require('./config');

const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({
      filename: '/app/logs/voice-worker.log',
      maxsize: 52428800, // 50MB
      maxFiles: 5
    })
  ]
});

module.exports = logger;
