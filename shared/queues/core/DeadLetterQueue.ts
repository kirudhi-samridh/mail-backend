/**
 * Universal Queue System - Dead Letter Queue Implementation
 * 
 * Handles jobs that fail after exhausting all retry attempts.
 * Provides analysis, requeue capabilities, and comprehensive monitoring
 * for failed jobs across the queue system.
 */

import { Queue, Job } from 'bullmq';
import { EventEmitter } from 'events';
import {
  IDeadLetterQueue,
  DeadLetterJob,
  DLQConfig,
  DLQStats,
  DLQOperationResult,
  DLQQueryOptions,
  JobAnalysis,
  DLQEvent,
  ConnectionConfig
} from '../types/interfaces';
import { Logger } from '../../logging/logger';

/**
 * Error Categories for automatic classification
 */
const ERROR_CATEGORIES = {
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  VALIDATION: 'validation',
  PERMISSION: 'permission',
  RATE_LIMIT: 'rate_limit',
  EXTERNAL_API: 'external_api',
  DATABASE: 'database',
  MEMORY: 'memory',
  CONFIGURATION: 'configuration',
  UNKNOWN: 'unknown'
} as const;

/**
 * Retryable Error Patterns
 */
const RETRYABLE_PATTERNS = [
  /timeout/i,
  /rate limit/i,
  /too many requests/i,
  /temporary/i,
  /unavailable/i,
  /network/i,
  /connection/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /503/,
  /502/,
  /504/
];

/**
 * Non-retryable Error Patterns
 */
const NON_RETRYABLE_PATTERNS = [
  /validation/i,
  /unauthorized/i,
  /forbidden/i,
  /not found/i,
  /bad request/i,
  /invalid/i,
  /401/,
  /403/,
  /404/,
  /400/
];

/**
 * Dead Letter Queue Implementation
 * 
 * A comprehensive system for managing failed jobs with intelligent
 * error analysis, automatic requeue capabilities, and detailed monitoring.
 */
export class DeadLetterQueue<TData = any> extends EventEmitter implements IDeadLetterQueue<TData> {
  private dlqStorage: Queue<DeadLetterJob<TData>>;
  private config: DLQConfig;
  private logger: Logger;
  private stats: {
    totalJobs: number;
    requeueSuccess: number;
    requeueFailures: number;
    autoRequeueAttempts: number;
    manualInterventions: number;
    categorizedErrors: Map<string, number>;
    queueDistribution: Map<string, number>;
  };
  private autoRequeueInterval?: NodeJS.Timeout;

  constructor(
    config: DLQConfig,
    connectionConfig: ConnectionConfig,
    name: string = 'dead-letter-queue'
  ) {
    super();
    this.config = { ...this.getDefaultConfig(), ...config };
    this.logger = new Logger(`dlq-${name}`);
    
    // Initialize statistics
    this.stats = {
      totalJobs: 0,
      requeueSuccess: 0,
      requeueFailures: 0,
      autoRequeueAttempts: 0,
      manualInterventions: 0,
      categorizedErrors: new Map(),
      queueDistribution: new Map(),
    };

    // Initialize BullMQ queue for DLQ storage
    this.dlqStorage = new Queue<DeadLetterJob<TData>>(name, {
      connection: connectionConfig,
      defaultJobOptions: {
        removeOnComplete: false, // Keep completed DLQ jobs for analysis
        removeOnFail: false,
        attempts: 1, // DLQ jobs don't retry
      },
    });

    this.setupEventListeners();
    this.startAutoRequeue();
    
    this.logger.info('Dead Letter Queue initialized', {
      config: this.config,
      autoRequeue: this.config.autoRequeue?.enabled
    });
  }

  // =============================================
  // Job Management
  // =============================================

  /**
   * Add a failed job to the DLQ
   */
  async addJob(job: DeadLetterJob<TData>): Promise<string> {
    try {
      // Categorize error and determine if retryable
      job.errorCategory = this.categorizeError(new Error(job.failureReason), job.context);
      job.isRetryable = this.isJobRetryable(job);
      
      // Add environment and timestamp info
      job.context.environment = process.env.NODE_ENV || 'development';
      job.movedToDLQAt = new Date();
      
      // Generate unique DLQ ID
      job.dlqId = `dlq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Store in DLQ
      const dlqJob = await this.dlqStorage.add('dlq-job', job, {
        jobId: job.dlqId,
      });

      // Update statistics
      this.stats.totalJobs++;
      this.stats.categorizedErrors.set(
        job.errorCategory,
        (this.stats.categorizedErrors.get(job.errorCategory) || 0) + 1
      );
      this.stats.queueDistribution.set(
        job.queueName,
        (this.stats.queueDistribution.get(job.queueName) || 0) + 1
      );

      this.emit('job-added', { dlqId: job.dlqId, job });
      this.logger.info(`Job moved to DLQ: ${job.originalJobId}`, {
        dlqId: job.dlqId,
        originalJobId: job.originalJobId,
        queueName: job.queueName,
        errorCategory: job.errorCategory,
        isRetryable: job.isRetryable
      });

      // Check notification thresholds
      await this.checkNotificationThresholds();

      return job.dlqId;
    } catch (error) {
      this.logger.error('Failed to add job to DLQ', {
        originalJobId: job.originalJobId,
        error: (error as Error).message
      });
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get a specific DLQ job by ID
   */
  async getJob(dlqId: string): Promise<DeadLetterJob<TData> | null> {
    try {
      const job = await this.dlqStorage.getJob(dlqId);
      return job?.data || null;
    } catch (error) {
      this.logger.error(`Failed to get DLQ job: ${dlqId}`, {
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Get multiple DLQ jobs with filtering and sorting
   */
  async getJobs(options: DLQQueryOptions = {}): Promise<DeadLetterJob<TData>[]> {
    try {
      const {
        limit = 50,
        offset = 0,
        sortBy = 'movedToDLQAt',
        sortOrder = 'desc'
      } = options;

      // Get jobs from storage (simplified - in production you'd use Redis queries)
      const allJobs = await this.dlqStorage.getJobs(['completed', 'failed'], offset, offset + limit);
      
      let filteredJobs = allJobs
        .map(job => job.data as DeadLetterJob<TData>)
        .filter(job => this.matchesFilter(job, options));

      // Sort jobs
      filteredJobs.sort((a, b) => {
        const aValue = a[sortBy] instanceof Date ? (a[sortBy] as Date).getTime() : a[sortBy];
        const bValue = b[sortBy] instanceof Date ? (b[sortBy] as Date).getTime() : b[sortBy];
        
        if (sortOrder === 'asc') {
          return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
        } else {
          return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
        }
      });

      return filteredJobs;
    } catch (error) {
      this.logger.error('Failed to get DLQ jobs', {
        options,
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Delete a job from DLQ
   */
  async deleteJob(dlqId: string): Promise<void> {
    try {
      const job = await this.dlqStorage.getJob(dlqId);
      if (job) {
        await job.remove();
        this.stats.manualInterventions++;
        this.emit('job-deleted', { dlqId });
        this.logger.info(`DLQ job deleted: ${dlqId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to delete DLQ job: ${dlqId}`, {
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Delete multiple jobs from DLQ
   */
  async deleteJobs(dlqIds: string[]): Promise<DLQOperationResult> {
    const result: DLQOperationResult = {
      success: true,
      affectedJobs: 0,
      errors: []
    };

    for (const dlqId of dlqIds) {
      try {
        await this.deleteJob(dlqId);
        result.affectedJobs++;
      } catch (error) {
        result.errors.push(`Failed to delete ${dlqId}: ${(error as Error).message}`);
        result.success = false;
      }
    }

    return result;
  }

  // =============================================
  // Requeue Operations
  // =============================================

  /**
   * Requeue a single job back to its original queue
   */
  async requeueJob(dlqId: string, targetQueue?: string): Promise<DLQOperationResult> {
    const result: DLQOperationResult = {
      success: false,
      affectedJobs: 0,
      errors: []
    };

    try {
      const dlqJob = await this.getJob(dlqId);
      if (!dlqJob) {
        result.errors.push(`DLQ job not found: ${dlqId}`);
        return result;
      }

      // Check if job is retryable
      if (!dlqJob.isRetryable) {
        result.errors.push(`Job is marked as non-retryable: ${dlqId}`);
        return result;
      }

      // Update requeue stats
      dlqJob.requeuAttempts++;
      dlqJob.lastRequeueAt = new Date();

      // Create new job in target queue
      const queueName = targetQueue || dlqJob.queueName;
      
      // Here you would integrate with your queue system to add the job back
      // For now, we'll simulate this
      this.logger.info(`Requeuing job to ${queueName}`, {
        dlqId,
        originalJobId: dlqJob.originalJobId,
        requeuAttempts: dlqJob.requeuAttempts
      });

      // Remove from DLQ
      await this.deleteJob(dlqId);

      this.stats.requeueSuccess++;
      this.stats.manualInterventions++;
      result.success = true;
      result.affectedJobs = 1;

      this.emit('job-requeued', { dlqId, targetQueue: queueName });

    } catch (error) {
      this.stats.requeueFailures++;
      result.errors.push(`Requeue failed: ${(error as Error).message}`);
      this.logger.error(`Failed to requeue job: ${dlqId}`, {
        error: (error as Error).message
      });
    }

    return result;
  }

  /**
   * Requeue multiple jobs
   */
  async requeueJobs(dlqIds: string[], targetQueue?: string): Promise<DLQOperationResult> {
    const result: DLQOperationResult = {
      success: true,
      affectedJobs: 0,
      errors: []
    };

    for (const dlqId of dlqIds) {
      const jobResult = await this.requeueJob(dlqId, targetQueue);
      result.affectedJobs += jobResult.affectedJobs;
      result.errors.push(...jobResult.errors);
      
      if (!jobResult.success) {
        result.success = false;
      }
    }

    return result;
  }

  /**
   * Requeue all jobs of a specific error category
   */
  async requeueByCategory(errorCategory: string, targetQueue?: string): Promise<DLQOperationResult> {
    try {
      const jobs = await this.getJobs({ errorCategory });
      const retryableJobs = jobs.filter(job => job.isRetryable);
      const dlqIds = retryableJobs.map(job => job.dlqId);
      
      this.logger.info(`Requeuing ${dlqIds.length} jobs by category: ${errorCategory}`);
      return await this.requeueJobs(dlqIds, targetQueue);
    } catch (error) {
      this.logger.error(`Failed to requeue by category: ${errorCategory}`, {
        error: (error as Error).message
      });
      return {
        success: false,
        affectedJobs: 0,
        errors: [(error as Error).message]
      };
    }
  }

  // =============================================
  // Analysis
  // =============================================

  /**
   * Analyze a failed job for troubleshooting
   */
  async analyzeJob(dlqId: string): Promise<JobAnalysis> {
    const dlqJob = await this.getJob(dlqId);
    if (!dlqJob) {
      throw new Error(`DLQ job not found: ${dlqId}`);
    }

    // Count similar failures
    const similarJobs = await this.getJobs({
      errorCategory: dlqJob.errorCategory,
      queueName: dlqJob.queueName
    });

    const analysis: JobAnalysis = {
      dlqId,
      errorCategory: dlqJob.errorCategory || 'unknown',
      isRetryable: dlqJob.isRetryable,
      recommendedAction: this.getRecommendedAction(dlqJob),
      reasonForFailure: dlqJob.failureReason,
      possibleCauses: this.getPossibleCauses(dlqJob),
      suggestedFixes: this.getSuggestedFixes(dlqJob),
      similarFailures: similarJobs.length,
      riskLevel: this.assessRiskLevel(dlqJob, similarJobs.length),
      context: {
        jobFrequency: await this.getJobFrequency(dlqJob.jobName, dlqJob.queueName),
        errorFrequency: similarJobs.length,
        systemLoad: await this.getSystemLoad(),
        queueHealth: 'unknown' // Would integrate with queue health monitoring
      }
    };

    this.emit('analysis-completed', { dlqId, analysis });
    this.logger.info(`Job analysis completed: ${dlqId}`, {
      recommendedAction: analysis.recommendedAction,
      riskLevel: analysis.riskLevel,
      similarFailures: analysis.similarFailures
    });

    return analysis;
  }

  /**
   * Categorize error based on message and context
   */
  categorizeError(error: Error, context: any): string {
    const message = error.message.toLowerCase();
    const stack = error.stack?.toLowerCase() || '';

    if (message.includes('timeout') || message.includes('etimedout')) {
      return ERROR_CATEGORIES.TIMEOUT;
    }
    if (message.includes('network') || message.includes('econnreset') || message.includes('enotfound')) {
      return ERROR_CATEGORIES.NETWORK;
    }
    if (message.includes('rate limit') || message.includes('too many requests')) {
      return ERROR_CATEGORIES.RATE_LIMIT;
    }
    if (message.includes('unauthorized') || message.includes('forbidden') || message.includes('permission')) {
      return ERROR_CATEGORIES.PERMISSION;
    }
    if (message.includes('validation') || message.includes('invalid') || message.includes('bad request')) {
      return ERROR_CATEGORIES.VALIDATION;
    }
    if (message.includes('database') || message.includes('sql') || stack.includes('database')) {
      return ERROR_CATEGORIES.DATABASE;
    }
    if (message.includes('memory') || message.includes('heap') || message.includes('out of memory')) {
      return ERROR_CATEGORIES.MEMORY;
    }
    if (message.includes('config') || message.includes('environment')) {
      return ERROR_CATEGORIES.CONFIGURATION;
    }
    if (message.includes('api') || message.includes('external') || context.external) {
      return ERROR_CATEGORIES.EXTERNAL_API;
    }

    return ERROR_CATEGORIES.UNKNOWN;
  }

  /**
   * Determine if a job is retryable based on error patterns
   */
  isJobRetryable(job: DeadLetterJob<TData>): boolean {
    const errorMessage = job.failureReason.toLowerCase();
    
    // Check non-retryable patterns first
    for (const pattern of NON_RETRYABLE_PATTERNS) {
      if (pattern.test(errorMessage)) {
        return false;
      }
    }
    
    // Check retryable patterns
    for (const pattern of RETRYABLE_PATTERNS) {
      if (pattern.test(errorMessage)) {
        return true;
      }
    }
    
    // Check attempt count - if too many attempts, might not be retryable
    if (job.originalAttempts >= 5) {
      return false;
    }
    
    // Default to retryable for unknown errors with few attempts
    return job.originalAttempts < 3;
  }

  // =============================================
  // Maintenance
  // =============================================

  /**
   * Clean up old DLQ jobs
   */
  async cleanup(olderThan?: Date): Promise<DLQOperationResult> {
    const cutoffDate = olderThan || new Date(Date.now() - (this.config.retentionDays * 24 * 60 * 60 * 1000));
    
    try {
      this.emit('cleanup-started', { cutoffDate });
      this.logger.info('Starting DLQ cleanup', { cutoffDate });

      const jobs = await this.getJobs({
        dateRange: { from: new Date(0), to: cutoffDate }
      });

      const result = await this.deleteJobs(jobs.map(job => job.dlqId));
      
      this.emit('cleanup-completed', { ...result, cutoffDate });
      this.logger.info('DLQ cleanup completed', {
        affectedJobs: result.affectedJobs,
        errors: result.errors.length
      });

      return result;
    } catch (error) {
      this.logger.error('DLQ cleanup failed', {
        error: (error as Error).message
      });
      return {
        success: false,
        affectedJobs: 0,
        errors: [(error as Error).message]
      };
    }
  }

  /**
   * Get DLQ statistics
   */
  async getStats(): Promise<DLQStats> {
    try {
      const jobs = await this.getJobs({ limit: 1000 }); // Get more jobs for accurate stats
      
      const jobsByErrorCategory: Record<string, number> = {};
      const jobsByQueue: Record<string, number> = {};
      let oldestJob: Date | undefined;
      let newestJob: Date | undefined;
      let totalRetentionDays = 0;

      for (const job of jobs) {
        // Count by error category
        const category = job.errorCategory || 'unknown';
        jobsByErrorCategory[category] = (jobsByErrorCategory[category] || 0) + 1;
        
        // Count by queue
        jobsByQueue[job.queueName] = (jobsByQueue[job.queueName] || 0) + 1;
        
        // Track oldest and newest
        const movedDate = new Date(job.movedToDLQAt);
        if (!oldestJob || movedDate < oldestJob) {
          oldestJob = movedDate;
        }
        if (!newestJob || movedDate > newestJob) {
          newestJob = movedDate;
        }
        
        // Calculate retention days
        const retentionDays = (Date.now() - movedDate.getTime()) / (24 * 60 * 60 * 1000);
        totalRetentionDays += retentionDays;
      }

      return {
        totalJobs: this.stats.totalJobs,
        jobsByErrorCategory,
        jobsByQueue,
        oldestJob,
        newestJob,
        avgRetentionDays: jobs.length > 0 ? totalRetentionDays / jobs.length : 0,
        requeueSuccess: this.stats.requeueSuccess,
        requeueFailures: this.stats.requeueFailures,
        autoRequeueAttempts: this.stats.autoRequeueAttempts,
        manualInterventions: this.stats.manualInterventions
      };
    } catch (error) {
      this.logger.error('Failed to get DLQ stats', {
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Process automatic requeue for eligible jobs
   */
  async processAutoRequeue(): Promise<DLQOperationResult> {
    if (!this.config.autoRequeue?.enabled) {
      return { success: true, affectedJobs: 0, errors: [] };
    }

    try {
      this.emit('auto-requeue-started');
      this.logger.info('Starting auto-requeue process');

      const jobs = await this.getJobs({ limit: 100 });
      const eligibleJobs = jobs.filter(job => this.isEligibleForAutoRequeue(job));
      
      this.stats.autoRequeueAttempts += eligibleJobs.length;
      
      const result = await this.requeueJobs(eligibleJobs.map(job => job.dlqId));
      
      this.emit('auto-requeue-completed', result);
      this.logger.info('Auto-requeue process completed', {
        eligibleJobs: eligibleJobs.length,
        successful: result.affectedJobs,
        errors: result.errors.length
      });

      return result;
    } catch (error) {
      this.logger.error('Auto-requeue process failed', {
        error: (error as Error).message
      });
      return {
        success: false,
        affectedJobs: 0,
        errors: [(error as Error).message]
      };
    }
  }

  // =============================================
  // Private Helper Methods
  // =============================================

  private getDefaultConfig(): DLQConfig {
    return {
      enabled: true,
      maxRetries: 3,
      retentionDays: 7,
      maxSize: 10000,
      autoRequeue: {
        enabled: false,
        attempts: 2,
        backoffMultiplier: 2,
        maxBackoffMs: 300000 // 5 minutes
      },
      notification: {
        enabled: false,
        thresholds: {
          count: 100,
          timeWindowMs: 3600000 // 1 hour
        }
      }
    };
  }

  private setupEventListeners(): void {
    // Set up any additional event listeners for the DLQ storage
    this.dlqStorage.on('error', (error) => {
      this.logger.error('DLQ storage error', { error: error.message });
      this.emit('error', error);
    });
  }

  private startAutoRequeue(): void {
    if (this.config.autoRequeue?.enabled) {
      const interval = 5 * 60 * 1000; // 5 minutes
      this.autoRequeueInterval = setInterval(() => {
        this.processAutoRequeue().catch(error => {
          this.logger.error('Auto-requeue interval error', {
            error: error.message
          });
        });
      }, interval);
      
      this.logger.info('Auto-requeue started', { intervalMs: interval });
    }
  }

  private matchesFilter(job: DeadLetterJob<TData>, options: DLQQueryOptions): boolean {
    if (options.queueName && job.queueName !== options.queueName) {
      return false;
    }
    
    if (options.errorCategory && job.errorCategory !== options.errorCategory) {
      return false;
    }
    
    if (options.dateRange) {
      const jobDate = new Date(job.movedToDLQAt);
      if (jobDate < options.dateRange.from || jobDate > options.dateRange.to) {
        return false;
      }
    }
    
    if (options.tags && options.tags.length > 0) {
      const hasMatchingTag = options.tags.some(tag => job.tags.includes(tag));
      if (!hasMatchingTag) {
        return false;
      }
    }
    
    return true;
  }

  private isEligibleForAutoRequeue(job: DeadLetterJob<TData>): boolean {
    if (!this.config.autoRequeue?.enabled || !job.isRetryable) {
      return false;
    }
    
    const maxAttempts = this.config.autoRequeue.attempts || 2;
    if (job.requeuAttempts >= maxAttempts) {
      return false;
    }
    
    // Check backoff timing
    if (job.lastRequeueAt) {
      const backoffMs = Math.min(
        Math.pow(this.config.autoRequeue.backoffMultiplier || 2, job.requeuAttempts) * 60000,
        this.config.autoRequeue.maxBackoffMs || 300000
      );
      
      const timeSinceLastRequeue = Date.now() - job.lastRequeueAt.getTime();
      if (timeSinceLastRequeue < backoffMs) {
        return false;
      }
    }
    
    return true;
  }

  private async checkNotificationThresholds(): Promise<void> {
    if (!this.config.notification?.enabled) {
      return;
    }
    
    const threshold = this.config.notification.thresholds;
    const windowStart = new Date(Date.now() - threshold.timeWindowMs);
    
    const recentJobs = await this.getJobs({
      dateRange: { from: windowStart, to: new Date() }
    });
    
    if (recentJobs.length >= threshold.count) {
      this.emit('threshold-exceeded', {
        count: recentJobs.length,
        threshold: threshold.count,
        timeWindowMs: threshold.timeWindowMs
      });
      
      this.logger.warn('DLQ threshold exceeded', {
        count: recentJobs.length,
        threshold: threshold.count,
        timeWindowMs: threshold.timeWindowMs
      });
    }
  }

  private getRecommendedAction(job: DeadLetterJob<TData>): 'requeue' | 'manual_fix' | 'discard' | 'investigate' {
    if (!job.isRetryable) {
      return job.errorCategory === ERROR_CATEGORIES.VALIDATION ? 'discard' : 'manual_fix';
    }
    
    if (job.requeuAttempts < 2 && job.originalAttempts < 5) {
      return 'requeue';
    }
    
    return 'investigate';
  }

  private getPossibleCauses(job: DeadLetterJob<TData>): string[] {
    const causes: string[] = [];
    
    switch (job.errorCategory) {
      case ERROR_CATEGORIES.NETWORK:
        causes.push('Network connectivity issues', 'DNS resolution problems', 'Firewall blocking');
        break;
      case ERROR_CATEGORIES.TIMEOUT:
        causes.push('Slow external service', 'High system load', 'Database performance issues');
        break;
      case ERROR_CATEGORIES.RATE_LIMIT:
        causes.push('API rate limits exceeded', 'Too many concurrent requests');
        break;
      case ERROR_CATEGORIES.VALIDATION:
        causes.push('Invalid input data', 'Schema mismatch', 'Missing required fields');
        break;
      case ERROR_CATEGORIES.PERMISSION:
        causes.push('Invalid credentials', 'Expired tokens', 'Insufficient permissions');
        break;
      default:
        causes.push('Unknown error condition', 'System instability');
    }
    
    return causes;
  }

  private getSuggestedFixes(job: DeadLetterJob<TData>): string[] {
    const fixes: string[] = [];
    
    switch (job.errorCategory) {
      case ERROR_CATEGORIES.NETWORK:
        fixes.push('Check network connectivity', 'Verify DNS settings', 'Review firewall rules');
        break;
      case ERROR_CATEGORIES.TIMEOUT:
        fixes.push('Increase timeout values', 'Optimize query performance', 'Scale resources');
        break;
      case ERROR_CATEGORIES.RATE_LIMIT:
        fixes.push('Implement exponential backoff', 'Reduce request frequency', 'Use rate limiting');
        break;
      case ERROR_CATEGORIES.VALIDATION:
        fixes.push('Fix input data validation', 'Update data schema', 'Add missing fields');
        break;
      case ERROR_CATEGORIES.PERMISSION:
        fixes.push('Refresh authentication tokens', 'Verify API permissions', 'Update credentials');
        break;
      default:
        fixes.push('Review error logs', 'Check system status', 'Contact support if needed');
    }
    
    return fixes;
  }

  private assessRiskLevel(job: DeadLetterJob<TData>, similarFailures: number): 'low' | 'medium' | 'high' {
    if (similarFailures > 50) return 'high';
    if (similarFailures > 10) return 'medium';
    return 'low';
  }

  private async getJobFrequency(jobName: string, queueName: string): Promise<number> {
    // In a real implementation, you'd query the job frequency from your metrics
    return 1; // Placeholder
  }

  private async getSystemLoad(): Promise<number> {
    // In a real implementation, you'd get actual system load
    return 0.5; // Placeholder
  }

  /**
   * Gracefully close the DLQ
   */
  async close(): Promise<void> {
    try {
      if (this.autoRequeueInterval) {
        clearInterval(this.autoRequeueInterval);
      }
      
      await this.dlqStorage.close();
      this.logger.info('Dead Letter Queue closed');
    } catch (error) {
      this.logger.error('Failed to close DLQ', {
        error: (error as Error).message
      });
      throw error;
    }
  }
} 