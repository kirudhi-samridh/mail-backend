/**
 * Universal Queue System - Job Processor
 * 
 * Generic job processing framework with middleware support.
 * Provides a consistent way to process jobs with logging, error handling,
 * and performance monitoring built-in.
 */

import { Job } from 'bullmq';
import { EventEmitter } from 'events';
import { Logger } from '../../logging/logger';

/**
 * Processor Middleware Function
 * Middleware that can modify job processing behavior
 */
export type ProcessorMiddleware<T = any> = (
  job: Job<T>,
  next: () => Promise<void>
) => Promise<void>;

/**
 * Job Processing Context
 * Additional context passed to processors
 */
export interface ProcessingContext<T = any> {
  job: Job<T>;
  startTime: Date;
  metadata: Record<string, any>;
  logger: Logger;
}

/**
 * Enhanced Job Processor Function
 * Processor function with additional context
 */
export type EnhancedJobProcessor<T = any> = (
  job: Job<T>,
  context: ProcessingContext<T>
) => Promise<any>;

/**
 * Simple Job Processor Function (backward compatibility)
 */
export type SimpleJobProcessor<T = any> = (job: Job<T>) => Promise<any>;

/**
 * Processing Result
 */
export interface ProcessingResult<T = any> {
  success: boolean;
  result?: any;
  error?: Error;
  duration: number;
  jobId: string;
  jobName: string;
  processingTime: Date;
  metadata: Record<string, any>;
}

/**
 * Processor Events
 */
export type ProcessorEvent = 
  | 'processing-started'
  | 'processing-completed'
  | 'processing-failed'
  | 'middleware-error'
  | 'context-created'
  | 'result-generated';

/**
 * Job Processor Implementation
 * 
 * A flexible job processing framework that supports middleware,
 * enhanced logging, error handling, and performance monitoring.
 */
export class JobProcessor<T = any> extends EventEmitter {
  private processor: EnhancedJobProcessor<T> | SimpleJobProcessor<T>;
  private middleware: ProcessorMiddleware<T>[] = [];
  private processingCount = 0;
  private totalProcessingTime = 0;
  private errors: Error[] = [];
  private logger: Logger;

  constructor(
    processor: EnhancedJobProcessor<T> | SimpleJobProcessor<T>,
    middleware: ProcessorMiddleware<T>[] = [],
    logger?: Logger
  ) {
    super();
    this.processor = processor;
    this.middleware = [...middleware];
    this.logger = logger || new Logger('queue-processor');
  }

  // =============================================
  // Job Processing
  // =============================================

  /**
   * Process a job with full middleware stack and context
   */
  async process(job: Job<T>): Promise<any> {
    const startTime = new Date();
    const jobId = job.id || 'unknown';
    const jobName = job.name || 'unknown';

    // Create child logger with job context
    const jobLogger = this.logger.child({
      jobId,
      jobName,
      queueName: job.queueName,
      timestamp: startTime.toISOString()
    });

    this.emit('processing-started', { jobId, jobName, startTime });
    jobLogger.info(`Job processing started: ${jobName}`);

    try {
      // Create processing context
      const context = this.createProcessingContext(job, startTime, jobLogger);
      this.emit('context-created', { jobId, context });

      // Run middleware stack
      await this.runMiddleware(job, context);

      // Execute the processor
      let result: any;
      
      if (this.isEnhancedProcessor(this.processor)) {
        result = await this.processor(job, context);
      } else {
        result = await (this.processor as SimpleJobProcessor<T>)(job);
      }

      // Calculate processing time
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      // Update statistics
      this.processingCount++;
      this.totalProcessingTime += duration;

      // Create processing result
      const processingResult: ProcessingResult<T> = {
        success: true,
        result,
        duration,
        jobId,
        jobName,
        processingTime: endTime,
        metadata: context.metadata,
      };

      this.emit('processing-completed', processingResult);
      this.emit('result-generated', { jobId, result, duration });

      jobLogger.info(`Job processing completed: ${jobName}`, {
        duration,
        success: true
      });

      return result;
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      // Track error
      this.errors.push(error as Error);
      
      // Keep only last 100 errors for memory efficiency
      if (this.errors.length > 100) {
        this.errors = this.errors.slice(-100);
      }

      // Create error result
      const processingResult: ProcessingResult<T> = {
        success: false,
        error: error as Error,
        duration,
        jobId,
        jobName,
        processingTime: endTime,
        metadata: {},
      };

      this.emit('processing-failed', processingResult);

      jobLogger.errorWithStack(`Job processing failed: ${jobName}`, error as Error, {
        duration,
        success: false
      });

      throw error;
    }
  }

  // =============================================
  // Middleware Management
  // =============================================

  /**
   * Add middleware to the processing stack
   */
  addMiddleware(middleware: ProcessorMiddleware<T>): void {
    this.middleware.push(middleware);
  }

  /**
   * Add multiple middleware at once
   */
  addMiddlewares(middlewares: ProcessorMiddleware<T>[]): void {
    this.middleware.push(...middlewares);
  }

  /**
   * Remove middleware from the stack
   */
  removeMiddleware(middleware: ProcessorMiddleware<T>): void {
    const index = this.middleware.indexOf(middleware);
    if (index > -1) {
      this.middleware.splice(index, 1);
    }
  }

  /**
   * Clear all middleware
   */
  clearMiddleware(): void {
    this.middleware = [];
  }

  /**
   * Get current middleware stack
   */
  getMiddleware(): ProcessorMiddleware<T>[] {
    return [...this.middleware];
  }

  // =============================================
  // Statistics and Monitoring
  // =============================================

  /**
   * Get processor statistics
   */
  getStats(): {
    totalProcessed: number;
    totalErrors: number;
    averageProcessingTime: number;
    successRate: number;
    recentErrors: string[];
    middlewareCount: number;
  } {
    const totalJobs = this.processingCount + this.errors.length;
    
    return {
      totalProcessed: this.processingCount,
      totalErrors: this.errors.length,
      averageProcessingTime: this.processingCount > 0 
        ? this.totalProcessingTime / this.processingCount 
        : 0,
      successRate: totalJobs > 0 
        ? this.processingCount / totalJobs 
        : 0,
      recentErrors: this.errors.slice(-10).map(err => err.message),
      middlewareCount: this.middleware.length,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.processingCount = 0;
    this.totalProcessingTime = 0;
    this.errors = [];
  }

  // =============================================
  // Event Handling
  // =============================================

  /**
   * Enhanced event handling with type safety
   */
  on(event: ProcessorEvent, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  off(event: ProcessorEvent, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }

  emit(event: ProcessorEvent, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  // =============================================
  // Private Methods
  // =============================================

  /**
   * Check if processor is enhanced (has context parameter)
   */
  private isEnhancedProcessor(
    processor: EnhancedJobProcessor<T> | SimpleJobProcessor<T>
  ): processor is EnhancedJobProcessor<T> {
    return processor.length > 1;
  }

  /**
   * Create processing context for job
   */
  private createProcessingContext(job: Job<T>, startTime: Date, logger: Logger): ProcessingContext<T> {
    return {
      job,
      startTime,
      metadata: {},
      logger,
    };
  }

  /**
   * Run middleware stack with proper async handling
   */
  private async runMiddleware(job: Job<T>, context: ProcessingContext<T>): Promise<void> {
    for (const middleware of this.middleware) {
      try {
        let middlewareCompleted = false;
        
        await middleware(job, async () => {
          middlewareCompleted = true;
        });
        
        if (!middlewareCompleted) {
          // If middleware didn't call next(), we still continue
          context.logger.warn('Middleware did not call next()', {
            middleware: middleware.name || 'anonymous'
          });
        }
      } catch (error) {
        context.logger.error('Middleware error', {
          middleware: middleware.name || 'anonymous',
          error: (error as Error).message
        });
        this.emit('middleware-error', { jobId: job.id, error, middleware });
        throw error;
      }
    }
  }
}

// =============================================
// Built-in Middleware
// =============================================

/**
 * Logging Middleware
 * Logs job processing events
 */
export const loggingMiddleware = <T = any>(
  job: Job<T>, 
  next: () => Promise<void>
): Promise<void> => {
  return next();
};

/**
 * Timing middleware that measures and logs processing time
 */
export const timingMiddleware = <T = any>(
  job: Job<T>, 
  next: () => Promise<void>
): Promise<void> => {
  const startTime = Date.now();
  
  return next().finally(() => {
    const duration = Date.now() - startTime;
    // Store timing information in job data for access by processor
    if (job.data && typeof job.data === 'object') {
      (job.data as any)._processingTime = duration;
    }
  });
};

/**
 * Error handling middleware that catches and logs errors
 */
export const errorHandlingMiddleware = <T = any>(
  job: Job<T>, 
  next: () => Promise<void>
): Promise<void> => {
  return next().catch((error) => {
    // Log error details
    console.error(`Job ${job.id} failed:`, error);
    
    // Re-throw to maintain error propagation
    throw error;
  });
};

/**
 * Progress tracking middleware that updates job progress
 */
export const progressTrackingMiddleware = <T = any>(
  job: Job<T>, 
  next: () => Promise<void>
): Promise<void> => {
  // Update progress to indicate processing started
  job.updateProgress(0);
  
  return next().finally(() => {
    // Update progress to indicate processing completed
    job.updateProgress(100);
  });
};

// =============================================
// Processor Factory Functions
// =============================================

/**
 * Create a simple processor with optional middleware
 */
export function createSimpleProcessor<T = any>(
  processor: SimpleJobProcessor<T>,
  options: {
    enableLogging?: boolean;
    enableTiming?: boolean;
    enableErrorHandling?: boolean;
    enableProgressTracking?: boolean;
    customMiddleware?: ProcessorMiddleware<T>[];
    logger?: Logger;
  } = {}
): JobProcessor<T> {
  const middleware: ProcessorMiddleware<T>[] = [];
  
  if (options.enableLogging) middleware.push(loggingMiddleware);
  if (options.enableTiming) middleware.push(timingMiddleware);
  if (options.enableErrorHandling) middleware.push(errorHandlingMiddleware);
  if (options.enableProgressTracking) middleware.push(progressTrackingMiddleware);
  if (options.customMiddleware) middleware.push(...options.customMiddleware);
  
  return new JobProcessor(processor, middleware, options.logger);
}

/**
 * Create an enhanced processor with context
 */
export function createEnhancedProcessor<T = any>(
  processor: EnhancedJobProcessor<T>,
  middleware: ProcessorMiddleware<T>[] = [],
  logger?: Logger
): JobProcessor<T> {
  return new JobProcessor(processor, middleware, logger);
} 