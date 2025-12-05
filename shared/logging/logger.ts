import winston from 'winston';
import * as dotenv from 'dotenv';

dotenv.config();

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 4,
} as const;

const LOG_COLORS = {
  error: 'red',
  warn: 'yellow',
  info: 'cyan',
  debug: 'white',
};

winston.addColors(LOG_COLORS);

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, service }) => {
    return `${timestamp} [${service || 'SYS'}] ${level}: ${message}`;
  })
);

const createLogger = (serviceName: string) => {
  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production' ? logFormat : consoleFormat,
      silent: process.env.NODE_ENV === 'test'
    })
  ];

  if (process.env.NODE_ENV === 'production') {
    transports.push(
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        format: logFormat,
        maxsize: 5242880,
        maxFiles: 3,
      }),
      new winston.transports.File({
        filename: 'logs/combined.log',
        format: logFormat,
        maxsize: 5242880,
        maxFiles: 3,
      })
    );
  }

  return winston.createLogger({
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info'),
    levels: LOG_LEVELS,
    defaultMeta: { service: serviceName },
    transports,
    exitOnError: false,
  });
};

export class Logger {
  private logger: winston.Logger;

  constructor(serviceName: string) {
    this.logger = createLogger(serviceName);
  }

  error(message: string, context?: LogContext): void {
    this.logger.error(message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.logger.warn(message, context);
  }

  info(message: string, context?: LogContext): void {
    this.logger.info(message, context);
  }

  debug(message: string, context?: LogContext): void {
    this.logger.debug(message, context);
  }

  logRequest(
    method: string,
    url: string,
    statusCode: number,
    duration: number,
    context?: LogContext
  ): void {
    this.info(`${method} ${url} ${statusCode} ${duration}ms`, context);
  }

  logError(message: string, error: Error, context?: LogContext): void {
    this.error(message, {
      ...context,
      error: error.message,
      stack: error.stack
    });
  }

  logProgress(action: string, success: boolean, context?: LogContext): void {
    if (success) {
      this.info(`Progress ${action}`, context);
    } else {
      this.warn(`Progress ${action} failed`, context);
    }
  }
}

export interface LogContext {
  userId?: string;
  requestId?: string;
  error?: string;
  [key: string]: any;
}

export const createServiceLogger = (serviceName: string): Logger => {
  return new Logger(serviceName);
};

export const logger = new Logger('system'); 