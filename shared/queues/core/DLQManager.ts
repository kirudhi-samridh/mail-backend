/**
 * Universal Queue System - Dead Letter Queue Manager
 * 
 * Centralized manager for handling Dead Letter Queues across multiple
 * queue instances. Provides system-wide DLQ operations, monitoring,
 * and administrative functions.
 */

import { EventEmitter } from 'events';
import {
  DeadLetterQueue,
  UniversalQueue
} from '../index';
import {
  DLQStats,
  DLQOperationResult,
  DLQQueryOptions,
  DeadLetterJob,
  JobAnalysis,
  DLQEvent,
  ConnectionConfig,
  DLQConfig
} from '../types/interfaces';
import { Logger } from '../../logging/logger';

/**
 * System-wide DLQ Statistics
 */
export interface SystemDLQStats {
  totalQueues: number;
  totalDLQJobs: number;
  totalJobsByQueue: Record<string, number>;
  totalJobsByCategory: Record<string, number>;
  oldestJob?: Date;
  newestJob?: Date;
  totalRequeuedJobs: number;
  totalFailedRequeues: number;
  systemHealth: 'healthy' | 'warning' | 'critical';
  lastUpdated: Date;
  queueStats: Record<string, DLQStats>;
}

/**
 * DLQ Operation Options
 */
export interface DLQOperationOptions {
  dryRun?: boolean;
  batchSize?: number;
  concurrency?: number;
  timeout?: number;
  notifyOnCompletion?: boolean;
}

/**
 * DLQ Health Check Result
 */
export interface DLQHealthCheck {
  queueName: string;
  status: 'healthy' | 'warning' | 'critical';
  issues: string[];
  jobCount: number;
  oldestJobAge: number;
  errorRate: number;
  recommendations: string[];
}

/**
 * Dead Letter Queue Manager
 * 
 * Provides centralized management and monitoring of Dead Letter Queues
 * across the entire queue system. Handles system-wide operations,
 * analytics, and maintenance tasks.
 */
export class DLQManager extends EventEmitter {
  private dlqs: Map<string, DeadLetterQueue> = new Map();
  private queues: Map<string, UniversalQueue> = new Map();
  private logger: Logger;
  private healthCheckInterval?: NodeJS.Timeout;
  private maintenanceInterval?: NodeJS.Timeout;
  private config: {
    healthCheckIntervalMs: number;
    maintenanceIntervalMs: number;
    autoCleanupEnabled: boolean;
    autoCleanupRetentionDays: number;
    globalNotificationThresholds: {
      totalJobs: number;
      errorRate: number;
      oldestJobDays: number;
    };
  };

  constructor(config?: Partial<DLQManager['config']>) {
    super();
    this.logger = new Logger('dlq-manager');
    
    this.config = {
      healthCheckIntervalMs: 5 * 60 * 1000, // 5 minutes
      maintenanceIntervalMs: 60 * 60 * 1000, // 1 hour
      autoCleanupEnabled: true,
      autoCleanupRetentionDays: 30,
      globalNotificationThresholds: {
        totalJobs: 1000,
        errorRate: 0.1, // 10%
        oldestJobDays: 14
      },
      ...config
    };

    this.startPeriodicTasks();
    this.logger.info('DLQ Manager initialized', { config: this.config });
  }

  // =============================================
  // Queue Registration
  // =============================================

  /**
   * Register a queue and its DLQ with the manager
   */
  registerQueue(queue: UniversalQueue): void {
    const queueName = queue['name']; // Access private property
    this.queues.set(queueName, queue);
    
    const dlq = queue.getDLQ();
    if (dlq) {
      this.dlqs.set(queueName, dlq);
      this.setupDLQEventForwarding(queueName, dlq);
      this.logger.info(`Queue registered with DLQ: ${queueName}`);
    } else {
      this.logger.info(`Queue registered without DLQ: ${queueName}`);
    }
  }

  /**
   * Unregister a queue from the manager
   */
  unregisterQueue(queueName: string): void {
    this.queues.delete(queueName);
    this.dlqs.delete(queueName);
    this.logger.info(`Queue unregistered: ${queueName}`);
  }

  /**
   * Get all registered queue names
   */
  getRegisteredQueues(): string[] {
    return Array.from(this.queues.keys());
  }

  /**
   * Get all queues with DLQ enabled
   */
  getDLQEnabledQueues(): string[] {
    return Array.from(this.dlqs.keys());
  }

  // =============================================
  // System-wide DLQ Operations
  // =============================================

  /**
   * Get system-wide DLQ statistics
   */
  async getSystemStats(): Promise<SystemDLQStats> {
    try {
      const queueStats: Record<string, DLQStats> = {};
      let totalDLQJobs = 0;
      let totalJobsByQueue: Record<string, number> = {};
      let totalJobsByCategory: Record<string, number> = {};
      let oldestJob: Date | undefined;
      let newestJob: Date | undefined;
      let totalRequeuedJobs = 0;
      let totalFailedRequeues = 0;

      // Collect stats from all DLQs
      for (const [queueName, dlq] of this.dlqs) {
        const stats = await dlq.getStats();
        queueStats[queueName] = stats;
        
        totalDLQJobs += stats.totalJobs;
        totalJobsByQueue[queueName] = stats.totalJobs;
        totalRequeuedJobs += stats.requeueSuccess;
        totalFailedRequeues += stats.requeueFailures;
        
        // Merge job counts by category
        for (const [category, count] of Object.entries(stats.jobsByErrorCategory)) {
          totalJobsByCategory[category] = (totalJobsByCategory[category] || 0) + count;
        }
        
        // Track oldest and newest jobs
        if (stats.oldestJob && (!oldestJob || stats.oldestJob < oldestJob)) {
          oldestJob = stats.oldestJob;
        }
        if (stats.newestJob && (!newestJob || stats.newestJob > newestJob)) {
          newestJob = stats.newestJob;
        }
      }

      // Determine system health
      const systemHealth = this.assessSystemHealth(queueStats);

      return {
        totalQueues: this.dlqs.size,
        totalDLQJobs,
        totalJobsByQueue,
        totalJobsByCategory,
        oldestJob,
        newestJob,
        totalRequeuedJobs,
        totalFailedRequeues,
        systemHealth,
        lastUpdated: new Date(),
        queueStats
      };
    } catch (error) {
      this.logger.error('Failed to get system DLQ stats', {
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Search for jobs across all DLQs
   */
  async searchJobs(options: DLQQueryOptions & { queueNames?: string[] }): Promise<{
    jobs: Array<DeadLetterJob & { queueName: string }>;
    totalCount: number;
  }> {
    try {
      const targetQueues = options.queueNames || Array.from(this.dlqs.keys());
      const allJobs: Array<DeadLetterJob & { queueName: string }> = [];

      for (const queueName of targetQueues) {
        const dlq = this.dlqs.get(queueName);
        if (!dlq) continue;

        const jobs = await dlq.getJobs(options);
        allJobs.push(...jobs.map(job => ({ ...job, queueName })));
      }

      // Sort combined results
      if (options.sortBy) {
        allJobs.sort((a, b) => {
          const aValue = a[options.sortBy!] instanceof Date 
            ? (a[options.sortBy!] as Date).getTime() 
            : a[options.sortBy!];
          const bValue = b[options.sortBy!] instanceof Date 
            ? (b[options.sortBy!] as Date).getTime() 
            : b[options.sortBy!];
          
          if (options.sortOrder === 'asc') {
            return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
          } else {
            return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
          }
        });
      }

      // Apply pagination to combined results
      const start = options.offset || 0;
      const end = start + (options.limit || 50);
      const paginatedJobs = allJobs.slice(start, end);

      return {
        jobs: paginatedJobs,
        totalCount: allJobs.length
      };
    } catch (error) {
      this.logger.error('Failed to search DLQ jobs', {
        error: (error as Error).message,
        options
      });
      throw error;
    }
  }

  /**
   * Bulk requeue jobs across multiple queues
   */
  async bulkRequeue(
    jobSelections: Array<{ queueName: string; dlqIds: string[] }>,
    options: DLQOperationOptions = {}
  ): Promise<DLQOperationResult> {
    const result: DLQOperationResult = {
      success: true,
      affectedJobs: 0,
      errors: [],
      details: {
        queueResults: {} as Record<string, DLQOperationResult>
      }
    };

    try {
      this.logger.info('Starting bulk requeue operation', {
        totalSelections: jobSelections.length,
        dryRun: options.dryRun
      });

      for (const selection of jobSelections) {
        const dlq = this.dlqs.get(selection.queueName);
        if (!dlq) {
          result.errors.push(`DLQ not found for queue: ${selection.queueName}`);
          result.success = false;
          continue;
        }

        if (options.dryRun) {
          result.details!.queueResults[selection.queueName] = {
            success: true,
            affectedJobs: selection.dlqIds.length,
            errors: []
          };
          continue;
        }

        const queueResult = await dlq.requeueJobs(selection.dlqIds);
        result.details!.queueResults[selection.queueName] = queueResult;
        result.affectedJobs += queueResult.affectedJobs;
        result.errors.push(...queueResult.errors);
        
        if (!queueResult.success) {
          result.success = false;
        }
      }

      this.logger.info('Bulk requeue operation completed', {
        success: result.success,
        affectedJobs: result.affectedJobs,
        errors: result.errors.length,
        dryRun: options.dryRun
      });

      this.emit('bulk-requeue-completed', result);
      return result;

    } catch (error) {
      this.logger.error('Bulk requeue operation failed', {
        error: (error as Error).message
      });
      result.success = false;
      result.errors.push((error as Error).message);
      return result;
    }
  }

  /**
   * Bulk cleanup across all DLQs
   */
  async bulkCleanup(
    olderThan?: Date,
    options: DLQOperationOptions = {}
  ): Promise<DLQOperationResult> {
    const result: DLQOperationResult = {
      success: true,
      affectedJobs: 0,
      errors: [],
      details: {
        queueResults: {} as Record<string, DLQOperationResult>
      }
    };

    try {
      const cutoffDate = olderThan || new Date(
        Date.now() - (this.config.autoCleanupRetentionDays * 24 * 60 * 60 * 1000)
      );

      this.logger.info('Starting bulk cleanup operation', {
        cutoffDate,
        totalQueues: this.dlqs.size,
        dryRun: options.dryRun
      });

      for (const [queueName, dlq] of this.dlqs) {
        if (options.dryRun) {
          // For dry run, count jobs that would be deleted
          const jobs = await dlq.getJobs({
            dateRange: { from: new Date(0), to: cutoffDate }
          });
          result.details!.queueResults[queueName] = {
            success: true,
            affectedJobs: jobs.length,
            errors: []
          };
          result.affectedJobs += jobs.length;
          continue;
        }

        const queueResult = await dlq.cleanup(cutoffDate);
        result.details!.queueResults[queueName] = queueResult;
        result.affectedJobs += queueResult.affectedJobs;
        result.errors.push(...queueResult.errors);
        
        if (!queueResult.success) {
          result.success = false;
        }
      }

      this.logger.info('Bulk cleanup operation completed', {
        success: result.success,
        affectedJobs: result.affectedJobs,
        errors: result.errors.length,
        dryRun: options.dryRun
      });

      this.emit('bulk-cleanup-completed', result);
      return result;

    } catch (error) {
      this.logger.error('Bulk cleanup operation failed', {
        error: (error as Error).message
      });
      result.success = false;
      result.errors.push((error as Error).message);
      return result;
    }
  }

  // =============================================
  // Health Monitoring
  // =============================================

  /**
   * Perform health check on all DLQs
   */
  async performHealthCheck(): Promise<DLQHealthCheck[]> {
    const healthChecks: DLQHealthCheck[] = [];

    for (const [queueName, dlq] of this.dlqs) {
      try {
        const stats = await dlq.getStats();
        const healthCheck = await this.assessQueueHealth(queueName, stats);
        healthChecks.push(healthCheck);
      } catch (error) {
        healthChecks.push({
          queueName,
          status: 'critical',
          issues: [`Health check failed: ${(error as Error).message}`],
          jobCount: 0,
          oldestJobAge: 0,
          errorRate: 0,
          recommendations: ['Investigate DLQ connection issues']
        });
      }
    }

    this.logger.info('Health check completed', {
      totalQueues: healthChecks.length,
      healthy: healthChecks.filter(h => h.status === 'healthy').length,
      warning: healthChecks.filter(h => h.status === 'warning').length,
      critical: healthChecks.filter(h => h.status === 'critical').length
    });

    return healthChecks;
  }

  /**
   * Get detailed analysis for a specific job across queues
   */
  async analyzeJob(queueName: string, dlqId: string): Promise<JobAnalysis> {
    const dlq = this.dlqs.get(queueName);
    if (!dlq) {
      throw new Error(`DLQ not found for queue: ${queueName}`);
    }

    return await dlq.analyzeJob(dlqId);
  }

  // =============================================
  // Administrative Functions
  // =============================================

  /**
   * Generate comprehensive DLQ report
   */
  async generateReport(): Promise<{
    systemStats: SystemDLQStats;
    healthChecks: DLQHealthCheck[];
    recommendations: string[];
    timestamp: Date;
  }> {
    try {
      const [systemStats, healthChecks] = await Promise.all([
        this.getSystemStats(),
        this.performHealthCheck()
      ]);

      const recommendations = this.generateRecommendations(systemStats, healthChecks);

      return {
        systemStats,
        healthChecks,
        recommendations,
        timestamp: new Date()
      };
    } catch (error) {
      this.logger.error('Failed to generate DLQ report', {
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Force auto-requeue processing on all DLQs
   */
  async processAutoRequeue(): Promise<Record<string, DLQOperationResult>> {
    const results: Record<string, DLQOperationResult> = {};

    for (const [queueName, dlq] of this.dlqs) {
      try {
        results[queueName] = await dlq.processAutoRequeue();
      } catch (error) {
        results[queueName] = {
          success: false,
          affectedJobs: 0,
          errors: [(error as Error).message]
        };
      }
    }

    this.logger.info('Auto-requeue processing completed', {
      queues: Object.keys(results).length,
      successful: Object.values(results).filter(r => r.success).length
    });

    return results;
  }

  // =============================================
  // Private Helper Methods
  // =============================================

  private setupDLQEventForwarding(queueName: string, dlq: DeadLetterQueue): void {
    const forwardEvent = (event: DLQEvent) => {
      return (...args: any[]) => {
        this.emit(event, { queueName, ...args[0] });
      };
    };

    dlq.on('job-added', forwardEvent('job-added'));
    dlq.on('job-requeued', forwardEvent('job-requeued'));
    dlq.on('job-deleted', forwardEvent('job-deleted'));
    dlq.on('threshold-exceeded', forwardEvent('threshold-exceeded'));
    dlq.on('error', forwardEvent('error'));
  }

  private startPeriodicTasks(): void {
    // Health checks
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        this.logger.error('Periodic health check failed', {
          error: (error as Error).message
        });
      }
    }, this.config.healthCheckIntervalMs);

    // Maintenance tasks
    this.maintenanceInterval = setInterval(async () => {
      try {
        if (this.config.autoCleanupEnabled) {
          await this.bulkCleanup();
        }
        await this.processAutoRequeue();
      } catch (error) {
        this.logger.error('Periodic maintenance failed', {
          error: (error as Error).message
        });
      }
    }, this.config.maintenanceIntervalMs);

    this.logger.info('Periodic tasks started', {
      healthCheckInterval: this.config.healthCheckIntervalMs,
      maintenanceInterval: this.config.maintenanceIntervalMs
    });
  }

  private assessSystemHealth(queueStats: Record<string, DLQStats>): 'healthy' | 'warning' | 'critical' {
    const totalJobs = Object.values(queueStats).reduce((sum, stats) => sum + stats.totalJobs, 0);
    const totalProcessed = Object.values(queueStats).reduce(
      (sum, stats) => sum + stats.requeueSuccess + stats.requeueFailures, 0
    );
    
    const errorRate = totalProcessed > 0 ? 
      Object.values(queueStats).reduce((sum, stats) => sum + stats.requeueFailures, 0) / totalProcessed : 0;

    // Check thresholds
    if (totalJobs > this.config.globalNotificationThresholds.totalJobs) {
      return 'critical';
    }
    
    if (errorRate > this.config.globalNotificationThresholds.errorRate) {
      return 'critical';
    }

    // Check for old jobs
    const now = Date.now();
    const maxAge = this.config.globalNotificationThresholds.oldestJobDays * 24 * 60 * 60 * 1000;
    const hasOldJobs = Object.values(queueStats).some(stats => 
      stats.oldestJob && (now - stats.oldestJob.getTime()) > maxAge
    );

    if (hasOldJobs || totalJobs > this.config.globalNotificationThresholds.totalJobs * 0.7) {
      return 'warning';
    }

    return 'healthy';
  }

  private async assessQueueHealth(queueName: string, stats: DLQStats): Promise<DLQHealthCheck> {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';

    // Check job count
    if (stats.totalJobs > 500) {
      issues.push(`High DLQ job count: ${stats.totalJobs}`);
      recommendations.push('Consider bulk requeue or cleanup operations');
      status = 'warning';
    }

    if (stats.totalJobs > 1000) {
      status = 'critical';
    }

    // Check age of oldest job
    const oldestJobAge = stats.oldestJob ? 
      (Date.now() - stats.oldestJob.getTime()) / (24 * 60 * 60 * 1000) : 0;

    if (oldestJobAge > 14) {
      issues.push(`Old jobs detected: ${Math.round(oldestJobAge)} days`);
      recommendations.push('Review and clean up old DLQ jobs');
      if (status === 'healthy') status = 'warning';
    }

    if (oldestJobAge > 30) {
      status = 'critical';
    }

    // Check error rate
    const totalAttempts = stats.requeueSuccess + stats.requeueFailures;
    const errorRate = totalAttempts > 0 ? stats.requeueFailures / totalAttempts : 0;

    if (errorRate > 0.2) {
      issues.push(`High requeue failure rate: ${Math.round(errorRate * 100)}%`);
      recommendations.push('Investigate recurring job failures');
      if (status === 'healthy') status = 'warning';
    }

    if (errorRate > 0.5) {
      status = 'critical';
    }

    // Add general recommendations based on status
    if (status === 'critical') {
      recommendations.push('Immediate attention required for DLQ health');
    } else if (status === 'warning') {
      recommendations.push('Monitor DLQ closely and consider preventive actions');
    }

    return {
      queueName,
      status,
      issues,
      jobCount: stats.totalJobs,
      oldestJobAge,
      errorRate,
      recommendations
    };
  }

  private generateRecommendations(
    systemStats: SystemDLQStats, 
    healthChecks: DLQHealthCheck[]
  ): string[] {
    const recommendations: string[] = [];

    // System-level recommendations
    if (systemStats.systemHealth === 'critical') {
      recommendations.push('CRITICAL: System DLQ health requires immediate attention');
    }

    if (systemStats.totalDLQJobs > 2000) {
      recommendations.push('Consider implementing more aggressive auto-requeue policies');
    }

    // Category-based recommendations
    const topCategories = Object.entries(systemStats.totalJobsByCategory)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3);

    for (const [category, count] of topCategories) {
      if (count > 100) {
        recommendations.push(`High failure rate in category '${category}': ${count} jobs - investigate root cause`);
      }
    }

    // Queue-specific recommendations
    const criticalQueues = healthChecks.filter(h => h.status === 'critical');
    if (criticalQueues.length > 0) {
      recommendations.push(
        `Critical queues requiring attention: ${criticalQueues.map(q => q.queueName).join(', ')}`
      );
    }

    return recommendations;
  }

  /**
   * Gracefully close the DLQ Manager
   */
  async close(): Promise<void> {
    try {
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }
      
      if (this.maintenanceInterval) {
        clearInterval(this.maintenanceInterval);
      }

      this.logger.info('DLQ Manager closed');
    } catch (error) {
      this.logger.error('Failed to close DLQ Manager', {
        error: (error as Error).message
      });
      throw error;
    }
  }
} 