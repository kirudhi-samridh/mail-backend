/**
 * Universal Queue System - Queue Registry
 * 
 * Central registry for managing all queues across the application.
 * Provides queue discovery, health monitoring, and lifecycle management.
 */

import { EventEmitter } from 'events';
import { IQueueRegistry, IUniversalQueue, QueueStats, HealthThresholds } from '../types/interfaces';
import { Logger } from '../../logging/logger';

/**
 * System Health Status
 */
export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  totalQueues: number;
  healthyQueues: number;
  unhealthyQueues: number;
  totalJobs: number;
  totalErrors: number;
  uptime: number;
  timestamp: Date;
  details: QueueHealthDetail[];
}

/**
 * Individual Queue Health Detail
 */
export interface QueueHealthDetail {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  jobCounts: {
    waiting: number;
    active: number;
    failed: number;
    total: number;
  };
  errorRate: number;
  lastActivity?: Date;
  issues?: string[];
}

/**
 * Registry Events
 */
export type RegistryEvent = 
  | 'queue-registered'
  | 'queue-unregistered'
  | 'health-check'
  | 'system-healthy'
  | 'system-degraded'
  | 'system-unhealthy'
  | 'error';

/**
 * Default Health Thresholds
 */
const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  errorRate: 0.1, // 10% error rate
  stalledJobCount: 10, // Max 10 stalled jobs
  processingTimeMs: 30000, // 30 seconds max processing time
  queueDepth: 1000, // Max 1000 waiting jobs
  workerUtilization: 0.95, // 95% worker utilization
};

/**
 * Queue Registry Implementation
 * 
 * Centralized management system for all queues in the application.
 * Provides registration, discovery, health monitoring, and lifecycle management.
 */
export class QueueRegistry extends EventEmitter implements IQueueRegistry {
  private queues = new Map<string, IUniversalQueue>();
  private queueConfigs = new Map<string, HealthThresholds>();
  private startTime: Date;
  private healthCheckInterval?: NodeJS.Timeout;
  private isShuttingDown = false;
  private logger: Logger;

  constructor() {
    super();
    this.startTime = new Date();
    this.logger = new Logger('queue-registry');
    this.setupHealthMonitoring();
  }

  // =============================================
  // Queue Registration
  // =============================================

  /**
   * Register a queue with the registry
   */
  register<T = any>(name: string, queue: IUniversalQueue<T>, healthThresholds?: HealthThresholds): void {
    if (this.queues.has(name)) {
      this.logger.warn(`Queue already registered: ${name}`);
      return;
    }

    this.queues.set(name, queue);
    
    // Store health thresholds for this queue
    if (healthThresholds) {
      this.queueConfigs.set(name, { ...DEFAULT_HEALTH_THRESHOLDS, ...healthThresholds });
    } else {
      this.queueConfigs.set(name, DEFAULT_HEALTH_THRESHOLDS);
    }

    // Setup event forwarding from the queue
    this.setupQueueEventForwarding(name, queue);

    this.emit('queue-registered', { name, queueCount: this.queues.size });
    this.logger.info(`Queue registered: ${name}`, { queueCount: this.queues.size });
  }

  /**
   * Unregister a queue from the registry
   */
  unregister(name: string): void {
    const queue = this.queues.get(name);
    if (!queue) {
      this.logger.warn(`Attempted to unregister non-existent queue: ${name}`);
      return;
    }

    this.queues.delete(name);
    this.queueConfigs.delete(name);
    this.emit('queue-unregistered', { name, queueCount: this.queues.size });
    
    this.logger.info(`Queue unregistered: ${name}`, { remaining: this.queues.size });
  }

  /**
   * Get a specific queue by name
   */
  get<T = any>(name: string): IUniversalQueue<T> | undefined {
    return this.queues.get(name) as IUniversalQueue<T> | undefined;
  }

  /**
   * Get all registered queues
   */
  getAll(): Map<string, IUniversalQueue> {
    return new Map(this.queues);
  }

  /**
   * Check if a queue exists
   */
  exists(name: string): boolean {
    return this.queues.has(name);
  }

  /**
   * List all queue names
   */
  list(): string[] {
    return Array.from(this.queues.keys());
  }

  /**
   * Clear all queues from the registry
   */
  clear(): void {
    const queueNames = this.list();
    
    for (const name of queueNames) {
      this.unregister(name);
    }
    
    this.logger.info('Cleared all queues from registry');
  }

  // =============================================
  // Health Monitoring
  // =============================================

  /**
   * Get comprehensive system health status
   */
  async getSystemHealth(): Promise<SystemHealth> {
    const details: QueueHealthDetail[] = [];
    let totalJobs = 0;
    let totalErrors = 0;
    let healthyQueues = 0;
    let unhealthyQueues = 0;

    // Collect health data from all queues
    for (const [name, queue] of Array.from(this.queues.entries())) {
      try {
        const stats = await queue.getStats();
        const queueHealth = this.evaluateQueueHealth(name, stats);
        
        details.push(queueHealth);
        totalJobs += stats.counts.total;
        totalErrors += stats.errors.totalErrors;
        
        if (queueHealth.status === 'healthy') {
          healthyQueues++;
        } else {
          unhealthyQueues++;
        }
      } catch (error) {
        // Queue is unresponsive
        const queueHealth: QueueHealthDetail = {
          name,
          status: 'unhealthy',
          jobCounts: { waiting: 0, active: 0, failed: 0, total: 0 },
          errorRate: 1.0,
          issues: ['Queue unresponsive']
        };
        
        details.push(queueHealth);
        unhealthyQueues++;
        
        this.logger.error(`Health check failed for queue: ${name}`, { error: (error as Error).message });
      }
    }

    // Determine overall system status
    const totalQueues = this.queues.size;
    let systemStatus: 'healthy' | 'degraded' | 'unhealthy';
    
    if (unhealthyQueues === 0) {
      systemStatus = 'healthy';
    } else if (healthyQueues > unhealthyQueues) {
      systemStatus = 'degraded';
    } else {
      systemStatus = 'unhealthy';
    }

    const health: SystemHealth = {
      status: systemStatus,
      totalQueues,
      healthyQueues,
      unhealthyQueues,
      totalJobs,
      totalErrors,
      uptime: Date.now() - this.startTime.getTime(),
      timestamp: new Date(),
      details,
    };

    // Emit health events
    this.emit('health-check', health);
    this.emit(`system-${systemStatus}`, health);

    // Log health status
    this.logger.info(`System health check completed`, {
      status: systemStatus,
      totalQueues,
      healthyQueues,
      unhealthyQueues,
      totalJobs,
      totalErrors
    });

    return health;
  }

  /**
   * Start periodic health monitoring
   */
  startHealthMonitoring(intervalMs: number = 30000): void {
    if (this.healthCheckInterval) {
      this.stopHealthMonitoring();
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.getSystemHealth();
      } catch (error) {
        this.emit('error', error);
        this.logger.error('Health monitoring error', { error: (error as Error).message });
      }
    }, intervalMs);

    this.logger.info(`Health monitoring started`, { intervalMs });
  }

  /**
   * Stop periodic health monitoring
   */
  stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
      this.logger.info('Health monitoring stopped');
    }
  }

  // =============================================
  // Queue Operations
  // =============================================

  /**
   * Pause all queues
   */
  async pauseAll(): Promise<void> {
    const pausePromises = Array.from(this.queues.values()).map(queue => 
      queue.pause().catch(error => {
        this.logger.error('Failed to pause queue', { error: (error as Error).message });
        return Promise.resolve();
      })
    );

    await Promise.all(pausePromises);
    this.logger.info('All queues paused');
  }

  /**
   * Resume all queues
   */
  async resumeAll(): Promise<void> {
    const resumePromises = Array.from(this.queues.values()).map(queue => 
      queue.resume().catch(error => {
        this.logger.error('Failed to resume queue', { error: (error as Error).message });
        return Promise.resolve();
      })
    );

    await Promise.all(resumePromises);
    this.logger.info('All queues resumed');
  }

  /**
   * Get statistics for all queues
   */
  async getAllStats(): Promise<Record<string, QueueStats>> {
    const stats: Record<string, QueueStats> = {};
    
    const statsPromises = Array.from(this.queues.entries()).map(async ([name, queue]) => {
      try {
        stats[name] = await queue.getStats();
      } catch (error) {
        this.logger.error(`Failed to get stats for queue: ${name}`, { error: (error as Error).message });
        // Create a placeholder stats object for failed queues
        stats[name] = {
          name,
          counts: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0, total: 0 },
          throughput: { jobsPerSecond: 0, jobsPerMinute: 0, jobsPerHour: 0, totalProcessed: 0, averageProcessingTime: 0 },
          latency: { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 },
          errors: { totalErrors: 0, errorRate: 1.0, recentErrors: [], errorsByType: {} },
          workers: { totalWorkers: 0, activeWorkers: 0, busyWorkers: 0, idleWorkers: 0, averageConcurrency: 0 },
          memory: { used: 0, peak: 0, percentage: 0 },
          uptime: 0,
          lastUpdated: new Date(),
        };
      }
    });

    await Promise.all(statsPromises);
    return stats;
  }

  // =============================================
  // Lifecycle Management
  // =============================================

  /**
   * Gracefully shutdown all queues
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    
    this.logger.info('Starting graceful shutdown of all queues');
    
    // Stop health monitoring
    this.stopHealthMonitoring();
    
    // Close all queues
    const shutdownPromises = Array.from(this.queues.entries()).map(async ([name, queue]) => {
      try {
        if (typeof (queue as any).close === 'function') {
          await (queue as any).close();
          this.logger.info(`Queue closed: ${name}`);
        }
      } catch (error) {
        this.logger.error(`Failed to close queue: ${name}`, { error: (error as Error).message });
      }
    });

    await Promise.all(shutdownPromises);
    
    // Clear the registry
    this.clear();
    
    this.logger.info('Queue registry shutdown completed');
  }

  // =============================================
  // Event Handling
  // =============================================

  /**
   * Enhanced event handling with type safety
   */
  on(event: RegistryEvent, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  off(event: RegistryEvent, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }

  emit(event: RegistryEvent, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  // =============================================
  // Private Helper Methods
  // =============================================

  /**
   * Setup health monitoring with default interval
   */
  private setupHealthMonitoring(): void {
    // Start health monitoring with 30-second interval by default
    this.startHealthMonitoring(30000);
  }

  /**
   * Setup event forwarding from individual queues
   */
  private setupQueueEventForwarding(name: string, queue: IUniversalQueue): void {
    // Forward critical events
    queue.on('error', (error) => {
      this.emit('error', { queue: name, error });
      this.logger.error(`Queue error: ${name}`, { error: (error as Error).message });
    });

    // Forward other important events
    queue.on('job-failed', (data) => {
      this.logger.warn(`Job failed in queue: ${name}`, data);
    });

    queue.on('worker-created', (data) => {
      this.logger.debug(`Worker created for queue: ${name}`, data);
    });
  }

  /**
   * Evaluate individual queue health using configurable thresholds
   */
  private evaluateQueueHealth(name: string, stats: QueueStats): QueueHealthDetail {
    const thresholds = this.queueConfigs.get(name) || DEFAULT_HEALTH_THRESHOLDS;
    const issues: string[] = [];
    
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    // Check error rate
    if (stats.errors.errorRate > (thresholds.errorRate || 0.1)) {
      status = 'unhealthy';
      issues.push(`High error rate: ${(stats.errors.errorRate * 100).toFixed(1)}%`);
    }
    
    // Check for too many failed jobs
    if (stats.counts.failed > (thresholds.stalledJobCount || 10)) {
      status = status === 'healthy' ? 'degraded' : 'unhealthy';
      issues.push(`Too many failed jobs: ${stats.counts.failed}`);
    }
    
    // Check queue depth
    if (stats.counts.waiting > (thresholds.queueDepth || 1000)) {
      status = status === 'healthy' ? 'degraded' : 'unhealthy';
      issues.push(`Queue depth too high: ${stats.counts.waiting}`);
    }
    
    // Check processing time
    if (stats.latency.avg > (thresholds.processingTimeMs || 30000)) {
      status = status === 'healthy' ? 'degraded' : 'unhealthy';
      issues.push(`Slow processing: ${stats.latency.avg.toFixed(0)}ms avg`);
    }
    
    // Check if no workers are running
    if (stats.workers.totalWorkers === 0 && stats.counts.waiting > 0) {
      status = 'degraded';
      issues.push('No workers running with pending jobs');
    }
    
    // Check worker utilization
    const workerUtilization = stats.workers.totalWorkers > 0 
      ? stats.workers.busyWorkers / stats.workers.totalWorkers 
      : 0;
    if (workerUtilization > (thresholds.workerUtilization || 0.95)) {
      status = status === 'healthy' ? 'degraded' : status;
      issues.push(`High worker utilization: ${(workerUtilization * 100).toFixed(1)}%`);
    }

    return {
      name,
      status,
      jobCounts: {
        waiting: stats.counts.waiting,
        active: stats.counts.active,
        failed: stats.counts.failed,
        total: stats.counts.total,
      },
      errorRate: stats.errors.errorRate,
      lastActivity: stats.lastUpdated,
      issues: issues.length > 0 ? issues : undefined,
    };
  }
}

// =============================================
// Singleton Instance
// =============================================

/**
 * Global queue registry instance
 * Use this for centralized queue management across the application
 */
export const queueRegistry = new QueueRegistry();

/**
 * Helper function to get the global queue registry
 */
export function getQueueRegistry(): QueueRegistry {
  return queueRegistry;
} 