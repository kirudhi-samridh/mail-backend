/**
 * Universal Queue System - Core Job Type Definitions
 * 
 * This file defines the core job interfaces and base types for the generic queue system.
 * Application-specific job types should be defined in your application code.
 */

/**
 * Base Job Data
 * Common fields shared across all job types
 */
export interface BaseJobData {
  userId?: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  metadata?: Record<string, any>;
}

/**
 * Generic Job Data
 * For applications to define their own job types
 */
export interface GenericJobData extends BaseJobData {
  jobType: string;
  data: Record<string, any>;
}

/**
 * Job Context
 * Additional context information for job processing
 */
export interface JobContext {
  correlationId?: string;
  parentJobId?: string;
  batchId?: string;
  retryCount?: number;
  maxRetries?: number;
  createdAt?: Date;
  scheduledFor?: Date;
}

/**
 * Job Result
 * Standard result structure for job completion
 */
export interface JobResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
  processingTime?: number;
}

/**
 * All Job Data Union Type
 * Applications can extend this by declaring module augmentation
 */
export type AllJobData = GenericJobData;

// Re-export onboarding types for module augmentation
export * from './onboarding-jobs'; 