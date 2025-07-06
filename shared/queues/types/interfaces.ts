/**
 * Universal Queue System - Core Interfaces
 * 
 * This file defines all the core interfaces and types that form the foundation
 * of the Universal Queue System. These interfaces ensure type safety and
 * provide a consistent API across all queue operations.
 */

import { Job, JobsOptions, Queue, Worker, BackoffOptions as BullMQBackoffOptions } from 'bullmq';

// =============================================
// Core Queue Interfaces
// =============================================

/**
 * Universal Queue Interface
 * The main interface that all queue implementations must implement.
 * Provides a generic, type-safe way to interact with any queue.
 */
export interface IUniversalQueue<TData = any> {
  // Job Management
  addJob<T = TData>(jobName: string, data: T, options?: JobOptions): Promise<string>;
  addBulkJobs<T = TData>(jobs: BulkJobData<T>[], options?: BulkJobOptions): Promise<string[]>;
  getJob(jobId: string): Promise<Job<TData> | null>;
  removeJob(jobId: string): Promise<void>;
  retryJob(jobId: string): Promise<void>;
  
  // Queue Control
  pause(): Promise<void>;
  resume(): Promise<void>;
  isPaused(): Promise<boolean>;
  drain(delayed?: boolean): Promise<void>;
  clean(grace: number, status: JobStatus): Promise<string[]>;
  
  // Monitoring
  getStats(): Promise<QueueStats>;
  getJobCounts(): Promise<JobCounts>;
  getWaiting(start?: number, end?: number): Promise<Job<TData>[]>;
  getActive(start?: number, end?: number): Promise<Job<TData>[]>;
  getCompleted(start?: number, end?: number): Promise<Job<TData>[]>;
  getFailed(start?: number, end?: number): Promise<Job<TData>[]>;
  
  // Workers
  createWorker(processor: JobProcessor<TData>, options?: WorkerOptions): Worker<TData>;
  getWorkers(): Worker<TData>[];
  
  // Dead Letter Queue Operations
  getDLQ(): any;
  getDLQStats(): Promise<any>;
  requeueFromDLQ(dlqId: string): Promise<boolean>;
  moveJobToDLQ(jobId: string, reason: string): Promise<string | null>;
  
  // Events
  on(event: QueueEvent, listener: (...args: any[]) => void): void;
  off(event: QueueEvent, listener: (...args: any[]) => void): void;
  emit(event: QueueEvent, ...args: any[]): boolean;
  
  // Lifecycle
  close(): Promise<void>;
}

/**
 * Queue Factory Interface
 * Factory pattern for creating queues with proper configuration.
 */
export interface IQueueFactory {
  create<T = any>(name: string, config?: QueueConfig): IUniversalQueue<T>;
  get<T = any>(name: string): IUniversalQueue<T> | undefined;
  list(): string[];
  destroy(name: string): Promise<void>;
  destroyAll(): Promise<void>;
}

/**
 * Job Processor Interface
 * Defines how jobs should be processed.
 */
export interface JobProcessor<TData = any> {
  (job: Job<TData>): Promise<any>;
}

/**
 * Queue Registry Interface
 * Central registry for managing all queues in the system.
 */
export interface IQueueRegistry {
  register<T = any>(name: string, queue: IUniversalQueue<T>): void;
  unregister(name: string): void;
  get<T = any>(name: string): IUniversalQueue<T> | undefined;
  getAll(): Map<string, IUniversalQueue>;
  exists(name: string): boolean;
  list(): string[];
  clear(): void;
}

// =============================================
// Configuration Interfaces
// =============================================

/**
 * Queue Configuration
 * Comprehensive configuration options for queue creation.
 */
export interface QueueConfig {
  // Connection
  connection?: ConnectionConfig;
  
  // Default Job Options
  defaultJobOptions?: JobOptions;
  
  // Queue Behavior
  concurrency?: number;
  maxRetries?: number;
  retryDelay?: number | ((attemptsMade: number) => number);
  
  // Performance
  stalledInterval?: number;
  maxStalledCount?: number;
  
  // Cleanup
  removeOnComplete?: number | boolean;
  removeOnFail?: number | boolean;
  
  // Advanced
  settings?: QueueSettings;
  
  // Worker Configuration
  workerOptions?: Partial<WorkerOptions>;
  
  // Monitoring
  enableMetrics?: boolean;
  metricsInterval?: number;
  
  // Health Check Configuration
  healthThresholds?: HealthThresholds;
  
  // Dead Letter Queue Configuration
  dlq?: DLQConfig;
}

/**
 * Connection Configuration
 * Redis connection settings for queues.
 */
export interface ConnectionConfig {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  family?: 4 | 6;
  connectTimeout?: number;
  commandTimeout?: number;
  retryDelayOnFailover?: number;
  enableReadyCheck?: boolean;
  maxRetriesPerRequest?: number | null;
  lazyConnect?: boolean;
  keepAlive?: number;
}

/**
 * Job Options
 * Options for individual job execution.
 */
export interface JobOptions extends JobsOptions {
  // Priority (higher number = higher priority)
  priority?: number;
  
  // Delay execution
  delay?: number;
  
  // Retry configuration
  attempts?: number;
  backoff?: BullMQBackoffOptions;
  
  // Job lifecycle
  removeOnComplete?: number | boolean;
  removeOnFail?: number | boolean;
  
  // Job metadata
  jobId?: string;
  
  // Advanced options
  lifo?: boolean;
  
  // Custom data
  metadata?: Record<string, any>;
}

/**
 * Worker Options
 * Configuration for job workers.
 */
export interface WorkerOptions {
  concurrency?: number;
  stalledInterval?: number;
  maxStalledCount?: number;
  autorun?: boolean;
  runRetryDelay?: number;
  settings?: WorkerSettings;
  // BullMQ-specific options for WSL compatibility
  drainDelay?: number;
  blockingTimeout?: number;
}

/**
 * Worker Settings
 * Advanced worker configuration.
 */
export interface WorkerSettings {
  stalledInterval?: number;
  maxStalledCount?: number;
  retryProcessDelay?: number;
}

/**
 * Queue Settings
 * Advanced queue behavior settings.
 */
export interface QueueSettings {
  stalledInterval?: number;
  retryProcessDelay?: number;
  backoffStrategies?: Record<string, BackoffStrategy>;
}

// =============================================
// Data Structures
// =============================================

/**
 * Bulk Job Data
 * Structure for adding multiple jobs at once.
 */
export interface BulkJobData<T = any> {
  name: string;
  data: T;
  opts?: JobOptions;
}

/**
 * Bulk Job Options
 * Options for bulk job operations.
 */
export interface BulkJobOptions {
  priority?: number;
  delay?: number;
  attempts?: number;
  lifo?: boolean;
}

/**
 * Queue Statistics
 * Comprehensive queue performance and status information.
 */
export interface QueueStats {
  name: string;
  counts: JobCounts;
  throughput: ThroughputStats;
  latency: LatencyStats;
  errors: ErrorStats;
  workers: WorkerStats;
  memory: MemoryStats;
  uptime: number;
  lastUpdated: Date;
}

/**
 * Job Counts
 * Count of jobs in different states.
 */
export interface JobCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  total: number;
}

/**
 * Throughput Statistics
 * Performance metrics for job processing.
 */
export interface ThroughputStats {
  jobsPerSecond: number;
  jobsPerMinute: number;
  jobsPerHour: number;
  totalProcessed: number;
  averageProcessingTime: number;
}

/**
 * Latency Statistics
 * Time-based performance metrics.
 */
export interface LatencyStats {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Error Statistics
 * Error tracking and analysis.
 */
export interface ErrorStats {
  totalErrors: number;
  errorRate: number;
  recentErrors: ErrorInfo[];
  errorsByType: Record<string, number>;
}

/**
 * Worker Statistics
 * Information about active workers.
 */
export interface WorkerStats {
  totalWorkers: number;
  activeWorkers: number;
  busyWorkers: number;
  idleWorkers: number;
  averageConcurrency: number;
}

/**
 * Memory Statistics
 * Memory usage tracking.
 */
export interface MemoryStats {
  used: number;
  peak: number;
  percentage: number;
}

/**
 * Error Information
 * Detailed error tracking.
 */
export interface ErrorInfo {
  timestamp: Date;
  jobId: string;
  error: string;
  stack?: string;
  attempts: number;
  data?: any;
}

// =============================================
// Enums and Type Unions
// =============================================

/**
 * Queue Types
 * Predefined queue types with specific configurations.
 */
export type QueueType = 
  | 'email-processing'
  | 'ai-processing'
  | 'automation'
  | 'integration-sync'
  | 'notifications'
  | 'briefing-generation'
  | 'cleanup'
  | 'onboarding'
  | 'realtime'
  | 'bulk-processing'
  | 'custom';

/**
 * Job Status
 * All possible states a job can be in.
 */
export type JobStatus = 
  | 'waiting'
  | 'wait'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed'
  | 'paused'
  | 'prioritized'
  | 'stalled';

/**
 * Queue Events
 * Events that can be emitted by queues.
 */
export type QueueEvent = 
  | 'waiting'
  | 'active'
  | 'stalled'
  | 'progress'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'resumed'
  | 'cleaned'
  | 'drained'
  | 'removed'
  | 'error'
  | 'job-added'
  | 'bulk-jobs-added'
  | 'job-removed'
  | 'job-retried'
  | 'job-completed'
  | 'job-failed'
  | 'job-moved-to-dlq'
  | 'worker-created'
  | 'closed';

/**
 * Priority Levels
 * Predefined priority levels for easy use.
 */
export type PriorityLevel = 
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'bulk';

/**
 * Backoff Types
 * Available backoff strategies for retries.
 */
export type BackoffType = 
  | 'fixed'
  | 'exponential'
  | 'linear'
  | 'custom';

/**
 * Backoff Strategy Function
 * Custom backoff strategy implementation.
 */
export type BackoffStrategy = (attemptsMade: number, err: Error) => number;

/**
 * Health Check Thresholds
 * Configurable thresholds for queue health evaluation
 */
export interface HealthThresholds {
  errorRate?: number;
  stalledJobCount?: number;
  processingTimeMs?: number;
  queueDepth?: number;
  workerUtilization?: number;
}

/**
 * Dead Letter Queue Configuration
 * Configuration for handling failed jobs
 */
export interface DLQConfig {
  enabled: boolean;
  maxRetries: number;
  retentionDays: number;
  maxSize?: number;
  autoRequeue?: {
    enabled: boolean;
    attempts: number;
    backoffMultiplier: number;
    maxBackoffMs: number;
  };
  notification?: {
    enabled: boolean;
    thresholds: {
      count: number;
      timeWindowMs: number;
    };
  };
}

/**
 * Dead Letter Job Information
 * Extended job information for failed jobs in DLQ
 */
export interface DeadLetterJob<TData = any> {
  // Original job information
  originalJobId: string;
  queueName: string;
  jobName: string;
  jobData: TData;
  
  // Failure information
  failureReason: string;
  failureStack?: string;
  originalAttempts: number;
  firstFailedAt: Date;
  lastFailedAt: Date;
  
  // DLQ metadata
  dlqId: string;
  movedToDLQAt: Date;
  requeuAttempts: number;
  lastRequeueAt?: Date;
  
  // Analysis
  errorCategory?: string;
  isRetryable: boolean;
  tags: string[];
  
  // Context
  context: {
    userId?: string;
    requestId?: string;
    environment: string;
    queueConfig: any;
  };
}

/**
 * DLQ Statistics
 * Statistics for dead letter queue monitoring
 */
export interface DLQStats {
  totalJobs: number;
  jobsByErrorCategory: Record<string, number>;
  jobsByQueue: Record<string, number>;
  oldestJob?: Date;
  newestJob?: Date;
  avgRetentionDays: number;
  requeueSuccess: number;
  requeueFailures: number;
  autoRequeueAttempts: number;
  manualInterventions: number;
}

/**
 * DLQ Operation Result
 * Result of DLQ operations like requeue, delete, etc.
 */
export interface DLQOperationResult {
  success: boolean;
  affectedJobs: number;
  errors: string[];
  details?: Record<string, any>;
}

/**
 * DLQ Query Options
 * Options for querying dead letter jobs
 */
export interface DLQQueryOptions {
  queueName?: string;
  errorCategory?: string;
  dateRange?: {
    from: Date;
    to: Date;
  };
  limit?: number;
  offset?: number;
  sortBy?: 'movedToDLQAt' | 'lastFailedAt' | 'requeuAttempts';
  sortOrder?: 'asc' | 'desc';
  tags?: string[];
}

/**
 * Dead Letter Queue Interface
 * Interface for managing failed jobs
 */
export interface IDeadLetterQueue<TData = any> {
  // Job Management
  addJob(job: DeadLetterJob<TData>): Promise<string>;
  getJob(dlqId: string): Promise<DeadLetterJob<TData> | null>;
  getJobs(options?: DLQQueryOptions): Promise<DeadLetterJob<TData>[]>;
  deleteJob(dlqId: string): Promise<void>;
  deleteJobs(dlqIds: string[]): Promise<DLQOperationResult>;
  
  // Requeue Operations
  requeueJob(dlqId: string, targetQueue?: string): Promise<DLQOperationResult>;
  requeueJobs(dlqIds: string[], targetQueue?: string): Promise<DLQOperationResult>;
  requeueByCategory(errorCategory: string, targetQueue?: string): Promise<DLQOperationResult>;
  
  // Analysis
  analyzeJob(dlqId: string): Promise<JobAnalysis>;
  categorizeError(error: Error, context: any): string;
  isJobRetryable(job: DeadLetterJob<TData>): boolean;
  
  // Maintenance
  cleanup(olderThan?: Date): Promise<DLQOperationResult>;
  getStats(): Promise<DLQStats>;
  
  // Auto-requeue
  processAutoRequeue(): Promise<DLQOperationResult>;
  
  // Events
  on(event: DLQEvent, listener: (...args: any[]) => void): void;
  off(event: DLQEvent, listener: (...args: any[]) => void): void;
  emit(event: DLQEvent, ...args: any[]): boolean;
}

/**
 * Job Analysis Result
 * Analysis of a failed job for troubleshooting
 */
export interface JobAnalysis {
  dlqId: string;
  errorCategory: string;
  isRetryable: boolean;
  recommendedAction: 'requeue' | 'manual_fix' | 'discard' | 'investigate';
  reasonForFailure: string;
  possibleCauses: string[];
  suggestedFixes: string[];
  similarFailures: number;
  riskLevel: 'low' | 'medium' | 'high';
  context: {
    jobFrequency: number;
    errorFrequency: number;
    systemLoad: number;
    queueHealth: string;
  };
}

/**
 * DLQ Events
 * Events emitted by the dead letter queue
 */
export type DLQEvent = 
  | 'job-added'
  | 'job-requeued'
  | 'job-deleted'
  | 'auto-requeue-started'
  | 'auto-requeue-completed'
  | 'cleanup-started'
  | 'cleanup-completed'
  | 'threshold-exceeded'
  | 'analysis-completed'
  | 'error'; 