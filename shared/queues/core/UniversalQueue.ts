/**
 * Universal Queue System - Universal Queue Implementation
 * 
 * This is the main queue implementation that wraps BullMQ with enhanced features,
 * type safety, and additional monitoring capabilities. It provides a consistent
 * API for all queue operations across the LMAA platform.
 */

import { Queue, Worker, QueueEvents, Job, ConnectionOptions, JobsOptions } from 'bullmq';
import { EventEmitter } from 'events';
import {
  IUniversalQueue,
  JobProcessor,
  JobOptions,
  WorkerOptions,
  QueueConfig,
  BulkJobData,
  BulkJobOptions,
  JobStatus,
  QueueEvent,
  QueueStats,
  JobCounts,
  ThroughputStats,
  LatencyStats,
  ErrorStats,
  WorkerStats,
  MemoryStats,
  ErrorInfo,
  DeadLetterJob,
  DLQStats
} from '../types/interfaces';
import { Logger } from '../../logging/logger';
import { DeadLetterQueue } from './DeadLetterQueue';

/**
 * Simple Histogram for efficient latency tracking
 */
class SimpleHistogram {
  private buckets: number[] = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];
  private counts: number[] = new Array(this.buckets.length + 1).fill(0);
  private values: number[] = [];
  private maxValues = 100; // Keep only last 100 values for percentile calculation

  add(value: number): void {
    // Add to histogram buckets
    let bucketIndex = this.buckets.findIndex(bucket => value <= bucket);
    if (bucketIndex === -1) bucketIndex = this.buckets.length;
    this.counts[bucketIndex]++;

    // Keep recent values for accurate percentiles
    this.values.push(value);
    if (this.values.length > this.maxValues) {
      this.values = this.values.slice(-this.maxValues);
    }
  }

  getStats(): { min: number; max: number; avg: number; p50: number; p95: number; p99: number } {
    if (this.values.length === 0) {
      return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...this.values].sort((a, b) => a - b);
    const len = sorted.length;

    return {
      min: sorted[0],
      max: sorted[len - 1],
      avg: sorted.reduce((a, b) => a + b, 0) / len,
      p50: sorted[Math.floor(len * 0.5)],
      p95: sorted[Math.floor(len * 0.95)],
      p99: sorted[Math.floor(len * 0.99)],
    };
  }

  getTotalCount(): number {
    return this.counts.reduce((a, b) => a + b, 0);
  }
}

/**
 * Universal Queue Implementation
 * 
 * A powerful, type-safe queue implementation built on top of BullMQ that provides
 * enhanced features like comprehensive monitoring, intelligent retry logic,
 * and seamless integration with the LMAA platform.
 */
export class UniversalQueue<TData = any> extends EventEmitter implements IUniversalQueue<TData> {
  private queue: Queue<TData>;
  private queueEvents: QueueEvents;
  private workers: Worker<TData>[] = [];
  private config: QueueConfig;
  private startTime: Date;
  private logger: Logger;
  private dlq?: DeadLetterQueue<TData>;
  private metrics: {
    totalJobsProcessed: number;
    totalErrors: number;
    latencyHistogram: SimpleHistogram;
    recentErrors: ErrorInfo[];
    errorsByType: Map<string, number>;
    workerStats: {
      totalWorkers: number;
      activeWorkers: Set<string>;
      busyWorkers: Set<string>;
    };
  };

  constructor(
    private name: string,
    config: QueueConfig
  ) {
    super();
    this.config = config;
    this.startTime = new Date();
    this.logger = new Logger(`queue-${name}`);
    this.metrics = {
      totalJobsProcessed: 0,
      totalErrors: 0,
      latencyHistogram: new SimpleHistogram(),
      recentErrors: [],
      errorsByType: new Map(),
      workerStats: {
        totalWorkers: 0,
        activeWorkers: new Set(),
        busyWorkers: new Set(),
      },
    };

    // Initialize BullMQ Queue
    this.queue = new Queue<TData>(name, {
      connection: this.buildConnectionOptions(),
      defaultJobOptions: config.defaultJobOptions as JobsOptions,
    });

    // Initialize Queue Events for monitoring
    this.queueEvents = new QueueEvents(name, {
      connection: this.buildConnectionOptions(),
    });

    // Initialize Dead Letter Queue if enabled
    if (config.dlq?.enabled) {
      this.dlq = new DeadLetterQueue<TData>(
        config.dlq,
        config.connection || {},
        `${name}-dlq`
      );
      this.logger.info(`Dead Letter Queue enabled for: ${name}`);
    }

    this.setupEventListeners();
  }

  // =============================================
  // Job Management
  // =============================================

  /**
   * Add a single job to the queue with type safety
   */
  async addJob<T = TData>(
    jobName: string, 
    data: T, 
    options?: JobOptions
  ): Promise<string> {
    try {
      const job = await this.queue.add(jobName as any, data as any, {
        ...this.config.defaultJobOptions,
        ...options,
      } as JobsOptions);
      
      this.emit('job-added', { jobId: job.id, jobName, data });
      this.logger.info(`Job added: ${jobName}`, { jobId: job.id, jobName });
      return job.id!;
    } catch (error) {
      this.emit('error', error);
      this.logger.error(`Failed to add job: ${jobName}`, { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Add multiple jobs to the queue in a batch
   */
  async addBulkJobs<T = TData>(
    jobs: BulkJobData<T>[], 
    options?: BulkJobOptions
  ): Promise<string[]> {
    try {
      const bullJobs = jobs.map(job => ({
        name: job.name,
        data: job.data,
        opts: {
          ...this.config.defaultJobOptions,
          ...options,
          ...job.opts,
        },
      }));

      const addedJobs = await this.queue.addBulk(bullJobs as any);
      const jobIds = addedJobs.map(job => job.id!);
      
      this.emit('bulk-jobs-added', { jobIds, count: jobs.length });
      this.logger.info(`Bulk jobs added: ${jobs.length} jobs`, { count: jobs.length });
      return jobIds;
    } catch (error) {
      this.emit('error', error);
      this.logger.error(`Failed to add bulk jobs`, { error: (error as Error).message, count: jobs.length });
      throw error;
    }
  }

  /**
   * Get a specific job by ID
   */
  async getJob(jobId: string): Promise<Job<TData> | null> {
    try {
      const job = await this.queue.getJob(jobId);
      return job || null;
    } catch (error) {
      this.emit('error', error);
      this.logger.error(`Failed to get job: ${jobId}`, { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Remove a job from the queue
   */
  async removeJob(jobId: string): Promise<void> {
    try {
      const job = await this.getJob(jobId);
      if (job) {
        await job.remove();
        this.emit('job-removed', { jobId });
        this.logger.info(`Job removed: ${jobId}`);
      }
    } catch (error) {
      this.emit('error', error);
      this.logger.error(`Failed to remove job: ${jobId}`, { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId: string): Promise<void> {
    try {
      const job = await this.getJob(jobId);
      if (job) {
        await job.retry();
        this.emit('job-retried', { jobId });
        this.logger.info(`Job retried: ${jobId}`);
      }
    } catch (error) {
      this.emit('error', error);
      this.logger.error(`Failed to retry job: ${jobId}`, { error: (error as Error).message });
      throw error;
    }
  }

  // =============================================
  // Dead Letter Queue Operations
  // =============================================

  /**
   * Get the Dead Letter Queue instance
   */
  getDLQ(): DeadLetterQueue<TData> | undefined {
    return this.dlq;
  }

  /**
   * Get DLQ statistics
   */
  async getDLQStats(): Promise<DLQStats | null> {
    if (!this.dlq) {
      return null;
    }
    return await this.dlq.getStats();
  }

  /**
   * Requeue a job from DLQ back to this queue
   */
  async requeueFromDLQ(dlqId: string): Promise<boolean> {
    if (!this.dlq) {
      throw new Error('DLQ is not enabled for this queue');
    }

    try {
      const result = await this.dlq.requeueJob(dlqId, this.name);
      return result.success;
    } catch (error) {
      this.logger.error(`Failed to requeue from DLQ: ${dlqId}`, {
        error: (error as Error).message
      });
      return false;
    }
  }

  /**
   * Move a job to DLQ manually
   */
  async moveJobToDLQ(jobId: string, reason: string): Promise<string | null> {
    if (!this.dlq) {
      this.logger.warn(`Cannot move job to DLQ - DLQ not enabled: ${jobId}`);
      return null;
    }

    try {
      const job = await this.getJob(jobId);
      if (!job) {
        throw new Error(`Job not found: ${jobId}`);
      }

      const dlqJob: DeadLetterJob<TData> = {
        originalJobId: jobId,
        queueName: this.name,
        jobName: job.name,
        jobData: job.data,
        failureReason: reason,
        failureStack: undefined,
        originalAttempts: job.attemptsMade || 0,
        firstFailedAt: new Date(),
        lastFailedAt: new Date(),
        dlqId: '', // Will be set by DLQ
        movedToDLQAt: new Date(),
        requeuAttempts: 0,
        isRetryable: false, // Manual moves are typically non-retryable
        tags: ['manual-move'],
        context: {
          userId: (job.data as any)?.userId,
          requestId: (job.data as any)?.requestId,
          environment: process.env.NODE_ENV || 'development',
          queueConfig: this.config
        }
      };

      const dlqId = await this.dlq.addJob(dlqJob);
      
      // Remove from original queue
      await this.removeJob(jobId);
      
      this.logger.info(`Job manually moved to DLQ: ${jobId} -> ${dlqId}`, {
        reason,
        originalJobId: jobId,
        dlqId
      });

      return dlqId;
    } catch (error) {
      this.logger.error(`Failed to move job to DLQ: ${jobId}`, {
        error: (error as Error).message,
        reason
      });
      throw error;
    }
  }

  // =============================================
  // Queue Control
  // =============================================

  /**
   * Pause the queue
   */
  async pause(): Promise<void> {
    try {
      await this.queue.pause();
      this.emit('paused');
      this.logger.info(`Queue paused: ${this.name}`);
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    try {
      await this.queue.resume();
      this.emit('resumed');
      this.logger.info(`Queue resumed: ${this.name}`);
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Check if queue is paused
   */
  async isPaused(): Promise<boolean> {
    try {
      return await this.queue.isPaused();
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Drain the queue (remove all waiting jobs)
   */
  async drain(delayed?: boolean): Promise<void> {
    try {
      await this.queue.drain(delayed);
      this.emit('drained');
      this.logger.info(`Queue drained: ${this.name}`, { delayed });
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Clean old jobs from the queue
   */
  async clean(grace: number, status: JobStatus): Promise<string[]> {
    try {
      const jobs = await this.queue.clean(grace, 0, status as any);
      this.emit('cleaned', { jobIds: jobs, count: jobs.length, status });
      this.logger.info(`Queue cleaned: ${this.name}`, { count: jobs.length, status, grace });
      return jobs;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  // =============================================
  // Monitoring and Statistics
  // =============================================

  /**
   * Get comprehensive queue statistics
   */
  async getStats(): Promise<QueueStats> {
    try {
      const counts = await this.getJobCounts();
      const throughput = this.calculateThroughputStats();
      const latency = this.calculateLatencyStats();
      const errors = this.calculateErrorStats();
      const workers = this.calculateWorkerStats();
      const memory = this.calculateMemoryStats();
      const uptime = Date.now() - this.startTime.getTime();

      return {
        name: this.name,
        counts,
        throughput,
        latency,
        errors,
        workers,
        memory,
        uptime,
        lastUpdated: new Date(),
      };
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get job counts by status
   */
  async getJobCounts(): Promise<JobCounts> {
    try {
      const waiting = await this.queue.getWaiting();
      const active = await this.queue.getActive();
      const completed = await this.queue.getCompleted();
      const failed = await this.queue.getFailed();
      const delayed = await this.queue.getDelayed();
      const paused = await this.isPaused() ? waiting.length : 0;

      return {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
        paused,
        total: waiting.length + active.length + completed.length + failed.length + delayed.length,
      };
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get waiting jobs
   */
  async getWaiting(start?: number, end?: number): Promise<Job<TData>[]> {
    try {
      return await this.queue.getWaiting(start, end);
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get active jobs
   */
  async getActive(start?: number, end?: number): Promise<Job<TData>[]> {
    try {
      return await this.queue.getActive(start, end);
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get completed jobs
   */
  async getCompleted(start?: number, end?: number): Promise<Job<TData>[]> {
    try {
      return await this.queue.getCompleted(start, end);
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get failed jobs
   */
  async getFailed(start?: number, end?: number): Promise<Job<TData>[]> {
    try {
      return await this.queue.getFailed(start, end);
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  // =============================================
  // Worker Management
  // =============================================

  /**
   * Create a worker for this queue
   */
  createWorker(processor: JobProcessor<TData>, options?: WorkerOptions): Worker<TData> {
    const worker = new Worker<TData>(this.name, processor, {
      connection: this.buildConnectionOptions(),
      concurrency: options?.concurrency || this.config.concurrency || 1,
      stalledInterval: options?.stalledInterval || this.config.stalledInterval,
      maxStalledCount: options?.maxStalledCount || this.config.maxStalledCount,
      autorun: options?.autorun !== false, 
      runRetryDelay: options?.runRetryDelay,
      // Apply worker options from config for WSL compatibility
      drainDelay: options?.drainDelay || this.config.workerOptions?.drainDelay,
      blockingTimeout: options?.blockingTimeout || this.config.workerOptions?.blockingTimeout,
    });

    // Setup worker event listeners for metrics
    worker.on('completed', (job) => {
      this.metrics.totalJobsProcessed++;
      const processingTime = Date.now() - (job.processedOn || Date.now());
      this.metrics.latencyHistogram.add(processingTime);
      
      // Update worker stats
      this.metrics.workerStats.busyWorkers.delete(worker.id!);
      
      this.emit('job-completed', { jobId: job.id, processingTime });
      this.logger.info(`Job completed: ${job.name}`, { jobId: job.id, processingTime });
    });

    worker.on('failed', async (job, err) => {
      this.metrics.totalErrors++;
      
      // Track error details
      const errorInfo: ErrorInfo = {
        timestamp: new Date(),
        jobId: job?.id || 'unknown',
        error: err.message,
        stack: err.stack,
        attempts: job?.attemptsMade || 0,
        data: job?.data,
      };
      
      this.metrics.recentErrors.push(errorInfo);
      if (this.metrics.recentErrors.length > 50) {
        this.metrics.recentErrors = this.metrics.recentErrors.slice(-50);
      }
      
      // Track errors by type
      const errorType = err.name || 'UnknownError';
      this.metrics.errorsByType.set(errorType, (this.metrics.errorsByType.get(errorType) || 0) + 1);
      
      // Update worker stats
      this.metrics.workerStats.busyWorkers.delete(worker.id!);
      
      // Check if job should be moved to DLQ
      await this.handleJobFailure(job, err);
      
      this.emit('job-failed', { jobId: job?.id, error: err.message });
      this.logger.error(`Job failed: ${job?.name}`, { jobId: job?.id, error: err.message });
    });

    worker.on('active', (job) => {
      this.metrics.workerStats.busyWorkers.add(worker.id!);
      this.logger.debug(`Job started: ${job.name}`, { jobId: job.id });
    });

    // Track worker lifecycle
    this.metrics.workerStats.totalWorkers++;
    this.metrics.workerStats.activeWorkers.add(worker.id!);
    
    this.workers.push(worker);
    this.emit('worker-created', { workerId: worker.id });
    this.logger.info(`Worker created for queue: ${this.name}`, { workerId: worker.id });

    return worker;
  }

  /**
   * Get all workers for this queue
   */
  getWorkers(): Worker<TData>[] {
    return [...this.workers];
  }

  // =============================================
  // Event Handling
  // =============================================

  /**
   * Enhanced event handling with type safety
   */
  on(event: QueueEvent, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  off(event: QueueEvent, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }

  emit(event: QueueEvent, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  // =============================================
  // Cleanup and Lifecycle
  // =============================================

  /**
   * Gracefully close the queue and all its resources
   */
  async close(): Promise<void> {
    try {
      // Close all workers
      await Promise.all(this.workers.map(worker => worker.close()));
      
      // Close queue events
      await this.queueEvents.close();
      
      // Close the queue
      await this.queue.close();
      
      // Close DLQ if enabled
      if (this.dlq) {
        await this.dlq.close();
      }
      
      this.emit('closed');
      this.logger.info(`Queue closed: ${this.name}`);
    } catch (error) {
      this.emit('error', error);
      this.logger.error(`Failed to close queue: ${this.name}`, { error: (error as Error).message });
      throw error;
    }
  }

  // =============================================
  // Private Helper Methods
  // =============================================

  /**
   * Handle job failure and determine if it should be moved to DLQ
   */
  private async handleJobFailure(job: Job<TData> | undefined, error: Error): Promise<void> {
    if (!job || !this.dlq) {
      return;
    }

    // Check if job has exhausted all retries
    const maxRetries = this.config.dlq?.maxRetries || this.config.maxRetries || 3;
    const attemptsMade = job.attemptsMade || 0;
    
    if (attemptsMade >= maxRetries) {
      try {
        // Create DLQ job
        const dlqJob: DeadLetterJob<TData> = {
          originalJobId: job.id || 'unknown',
          queueName: this.name,
          jobName: job.name,
          jobData: job.data,
          failureReason: error.message,
          failureStack: error.stack,
          originalAttempts: attemptsMade,
          firstFailedAt: job.failedReason ? new Date(job.timestamp) : new Date(),
          lastFailedAt: new Date(),
          dlqId: '', // Will be set by DLQ
          movedToDLQAt: new Date(),
          requeuAttempts: 0,
          isRetryable: false, // Will be determined by DLQ
          tags: ['max-retries-exceeded'],
          context: {
            userId: (job.data as any)?.userId,
            requestId: (job.data as any)?.requestId,
            environment: process.env.NODE_ENV || 'development',
            queueConfig: this.config
          }
        };

        const dlqId = await this.dlq.addJob(dlqJob);
        
        this.logger.warn(`Job moved to DLQ after max retries: ${job.id} -> ${dlqId}`, {
          originalJobId: job.id,
          dlqId,
          attempts: attemptsMade,
          maxRetries,
          error: error.message
        });

        this.emit('job-moved-to-dlq', { 
          originalJobId: job.id, 
          dlqId, 
          reason: 'max-retries-exceeded' 
        });

      } catch (dlqError) {
        this.logger.error(`Failed to move job to DLQ: ${job.id}`, {
          originalError: error.message,
          dlqError: (dlqError as Error).message
        });
      }
    }
  }

  /**
   * Build connection options from config
   */
  private buildConnectionOptions(): ConnectionOptions {
    const config = this.config.connection || {};
    return {
      host: config.host || 'localhost',
      port: config.port || 6379,
      password: config.password,
      db: config.db || 0,
      family: config.family || 4,
      connectTimeout: config.connectTimeout || 10000,
      commandTimeout: config.commandTimeout || 5000,
      retryDelayOnFailover: config.retryDelayOnFailover || 100,
      enableReadyCheck: config.enableReadyCheck !== false,
      maxRetriesPerRequest: config.maxRetriesPerRequest,
      lazyConnect: config.lazyConnect !== false,
      keepAlive: config.keepAlive || 30000,
    };
  }

  /**
   * Setup internal event listeners for monitoring
   */
  private setupEventListeners(): void {
    // Forward BullMQ events to our event emitter
    this.queueEvents.on('waiting', (job) => this.emit('waiting', job));
    this.queueEvents.on('active', (job) => this.emit('active', job));
    this.queueEvents.on('stalled', (job) => this.emit('stalled', job));
    this.queueEvents.on('progress', (job, progress) => this.emit('progress', job, progress));
    this.queueEvents.on('completed', (job) => this.emit('completed', job));
    this.queueEvents.on('failed', (job, err) => this.emit('failed', job, err));
    this.queueEvents.on('paused', () => this.emit('paused'));
    this.queueEvents.on('resumed', () => this.emit('resumed'));
    this.queueEvents.on('cleaned', (jobs, type) => this.emit('cleaned', jobs, type));
    this.queueEvents.on('drained', () => this.emit('drained'));
    this.queueEvents.on('removed', (job) => this.emit('removed', job));
  }

  /**
   * Calculate throughput statistics
   */
  private calculateThroughputStats(): ThroughputStats {
    const uptimeInSeconds = (Date.now() - this.startTime.getTime()) / 1000;
    const totalProcessed = this.metrics.totalJobsProcessed;
    
    return {
      jobsPerSecond: uptimeInSeconds > 0 ? totalProcessed / uptimeInSeconds : 0,
      jobsPerMinute: uptimeInSeconds > 0 ? (totalProcessed / uptimeInSeconds) * 60 : 0,
      jobsPerHour: uptimeInSeconds > 0 ? (totalProcessed / uptimeInSeconds) * 3600 : 0,
      totalProcessed,
      averageProcessingTime: this.metrics.latencyHistogram.getStats().avg,
    };
  }

  /**
   * Calculate latency statistics using histogram
   */
  private calculateLatencyStats(): LatencyStats {
    return this.metrics.latencyHistogram.getStats();
  }

  /**
   * Calculate comprehensive error statistics
   */
  private calculateErrorStats(): ErrorStats {
    const totalJobs = this.metrics.totalJobsProcessed + this.metrics.totalErrors;
    const errorsByType: Record<string, number> = {};
    
    this.metrics.errorsByType.forEach((count, errorType) => {
      errorsByType[errorType] = count;
    });
    
    return {
      totalErrors: this.metrics.totalErrors,
      errorRate: totalJobs > 0 ? this.metrics.totalErrors / totalJobs : 0,
      recentErrors: [...this.metrics.recentErrors],
      errorsByType,
    };
  }

  /**
   * Calculate comprehensive worker statistics
   */
  private calculateWorkerStats(): WorkerStats {
    const totalWorkers = this.metrics.workerStats.totalWorkers;
    const activeWorkers = this.metrics.workerStats.activeWorkers.size;
    const busyWorkers = this.metrics.workerStats.busyWorkers.size;
    
    return {
      totalWorkers,
      activeWorkers,
      busyWorkers,
      idleWorkers: activeWorkers - busyWorkers,
      averageConcurrency: totalWorkers > 0 ? this.config.concurrency || 1 : 0,
    };
  }

  /**
   * Calculate memory statistics
   */
  private calculateMemoryStats(): MemoryStats {
    const memUsage = process.memoryUsage();
    
    return {
      used: memUsage.heapUsed,
      peak: memUsage.heapTotal,
      percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
    };
  }
} 