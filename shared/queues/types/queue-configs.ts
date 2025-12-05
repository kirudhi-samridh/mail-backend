/**
 * Universal Queue System - Core Configuration Infrastructure
 * 
 * This file provides the core configuration infrastructure for the queue system.
 * Application-specific configurations should be defined in your application code.
 */

import { QueueConfig, QueueType, ConnectionConfig } from './interfaces';

// =============================================
// Priority Constants
// =============================================

export const PRIORITY_LEVELS = {
  CRITICAL: 10,
  HIGH: 7,
  MEDIUM: 5,
  LOW: 2,
  BULK: 1
} as const;

// =============================================
// Default Connection Configuration
// =============================================

export const DEFAULT_CONNECTION_CONFIG: ConnectionConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_QUEUE_DB || '3'),
  family: 4,
  connectTimeout: 60000,    // Increased for WSL compatibility
  commandTimeout: 120000,   // Increased for WSL compatibility
  retryDelayOnFailover: 100,
  enableReadyCheck: true,
  maxRetriesPerRequest: null,
  lazyConnect: true,
  keepAlive: 30000,
};

// =============================================
// Base Queue Configuration
// =============================================

export const BASE_QUEUE_CONFIG: QueueConfig = {
  connection: DEFAULT_CONNECTION_CONFIG,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 25,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    priority: PRIORITY_LEVELS.MEDIUM,
  },
  concurrency: 5,
  maxRetries: 3,
  stalledInterval: 30000,
  maxStalledCount: 1,
  enableMetrics: true,
  metricsInterval: 10000,
  // BullMQ Worker Settings - Reduce blocking time for WSL compatibility
  workerOptions: {
    drainDelay: 5,           // Short drain delay
    blockingTimeout: 10,     // 10 second blocking instead of default 30+
  },
};

// =============================================
// Configuration Utilities
// =============================================

/**
 * Get base queue configuration
 */
export function getBaseQueueConfig(): QueueConfig {
  return { ...BASE_QUEUE_CONFIG };
}

/**
 * Merge queue configuration with base config
 */
export function mergeQueueConfig(customConfig: Partial<QueueConfig>): QueueConfig {
  return {
    ...BASE_QUEUE_CONFIG,
    ...customConfig,
    connection: {
      ...BASE_QUEUE_CONFIG.connection,
      ...customConfig.connection,
    },
    defaultJobOptions: {
      ...BASE_QUEUE_CONFIG.defaultJobOptions,
      ...customConfig.defaultJobOptions,
    },
  };
}

/**
 * Get environment-specific configuration
 */
export function getEnvironmentConfig(): QueueConfig {
  const environment = process.env.NODE_ENV || 'development';
  
  switch (environment) {
    case 'production':
      return mergeQueueConfig({
        connection: {
          host: process.env.REDIS_HOST || 'redis-cluster.prod.local',
          connectTimeout: 30000,
          commandTimeout: 15000,
        },
        enableMetrics: true,
        metricsInterval: 10000,
      });
    
    case 'test':
      return mergeQueueConfig({
        connection: {
          db: 15,
        },
        enableMetrics: false,
        defaultJobOptions: {
          removeOnComplete: 5,
          removeOnFail: 5,
        },
      });
    
    default: // development
      return mergeQueueConfig({
        enableMetrics: true,
        metricsInterval: 5000,
      });
  }
}

/**
 * Create configuration with custom connection
 */
export function createConfigWithConnection(connection: Partial<ConnectionConfig>): QueueConfig {
  return mergeQueueConfig({
    connection: {
      ...DEFAULT_CONNECTION_CONFIG,
      ...connection,
    },
  });
} 