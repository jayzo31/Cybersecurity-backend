const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for different log levels
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Add colors to winston
winston.addColors(colors);

// Custom format for logs
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    if (info.stack) {
      return `${info.timestamp} ${info.level}: ${info.message}\n${info.stack}`;
    }
    return `${info.timestamp} ${info.level}: ${info.message}`;
  })
);

// File format (without colors)
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Console transport
const consoleTransport = new winston.transports.Console({
  format: logFormat,
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
});

// File transports
const transports = [consoleTransport];

// Add file transports only in production or when explicitly enabled
if (process.env.NODE_ENV === 'production' || process.env.ENABLE_FILE_LOGGING === 'true') {
  // Error log file
  transports.push(
    new DailyRotateFile({
      filename: path.join(logsDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      format: fileFormat,
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true
    })
  );

  // Combined log file
  transports.push(
    new DailyRotateFile({
      filename: path.join(logsDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      format: fileFormat,
      maxSize: '20m',
      maxFiles: '7d',
      zippedArchive: true
    })
  );
}

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  levels,
  format: fileFormat,
  transports,
  // Don't exit on handled exceptions
  exitOnError: false,
});

// Handle uncaught exceptions and unhandled rejections
if (process.env.NODE_ENV === 'production') {
  logger.exceptions.handle(
    new DailyRotateFile({
      filename: path.join(logsDir, 'exceptions-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      format: fileFormat
    })
  );

  logger.rejections.handle(
    new DailyRotateFile({
      filename: path.join(logsDir, 'rejections-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      format: fileFormat
    })
  );
}

// Add custom methods for better logging
logger.request = (req, res, responseTime) => {
  logger.http(`${req.method} ${req.originalUrl} ${res.statusCode} - ${responseTime}ms - ${req.ip}`);
};

logger.security = (message, details = {}) => {
  logger.warn(`SECURITY: ${message}`, details);
};

logger.database = (query, duration, error = null) => {
  if (error) {
    logger.error(`DB Error: ${query.substring(0, 100)}... (${duration}ms)`, { error: error.message });
  } else if (duration > 1000) {
    logger.warn(`Slow DB Query: ${query.substring(0, 100)}... (${duration}ms)`);
  } else {
    logger.debug(`DB Query: ${query.substring(0, 100)}... (${duration}ms)`);
  }
};

logger.api = (endpoint, method, statusCode, responseTime, userId = null) => {
  const logData = {
    endpoint,
    method,
    statusCode,
    responseTime: `${responseTime}ms`,
    userId
  };
  
  if (statusCode >= 500) {
    logger.error('API Error', logData);
  } else if (statusCode >= 400) {
    logger.warn('API Client Error', logData);
  } else {
    logger.info('API Request', logData);
  }
};

// Export the logger
module.exports = logger;