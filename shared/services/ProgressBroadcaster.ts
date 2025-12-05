/**
 * Progress Broadcasting System
 * 
 * Provides real-time progress tracking and broadcasting for long-running operations
 * like email syncing, AI processing, and onboarding workflows.
 */

import { Redis } from 'ioredis';
import { EventEmitter } from 'events';
import { getRedisConnection } from '../redis/connection';
import { logger } from '../logging/logger';

// =============================================
// Interfaces
// =============================================

export interface ProgressMetadata {
  type: 'onboarding' | 'email-sync' | 'ai-processing' | 'general';
  userId?: string;
  accountId?: string;
  description?: string;
  estimatedDuration?: number;
  [key: string]: any;
}

export interface ProgressStatus {
  jobId: string;
  totalItems: number;
  completed: number;
  percentage: number;
  currentAction?: string;
  startTime: Date;
  estimatedEndTime?: Date;
  metadata?: ProgressMetadata;
  subTasks?: { [key: string]: SubTaskProgress };
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  error?: Error;
  result?: any;
}

export interface SubTaskProgress {
  subTaskId: string;
  weight: number; // Percentage of parent task (0-100)
  completed: number;
  total: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export interface JobResult {
  success: boolean;
  data?: any;
  summary?: string;
  metrics?: { [key: string]: any };
}

export type ProgressCallback = (progress: ProgressStatus) => void;

// =============================================
// Progress Broadcasting System
// =============================================

export class ProgressBroadcaster extends EventEmitter {
  private redis: Redis;
  private subscribers: Map<string, Set<ProgressCallback>> = new Map();
  private readonly PROGRESS_TTL = 3600; // 1 hour in seconds
  private readonly KEY_PREFIX = 'progress:';
  
  // In-memory fallback when Redis fails
  private memoryCache: Map<string, ProgressStatus> = new Map();
  private redisFailure = false;
  
  // Track which items have been synced to Redis to avoid duplicate syncs
  private syncedToRedis: Set<string> = new Set();
  private lastSyncTime: number = 0;

  constructor() {
    super();
    this.redis = getRedisConnection(4, 'lmaa:progress:'); // Use dedicated database 4 for progress
    this.setupCleanup();
    
    // Test Redis connection and fallback to memory if needed
    this.testRedisConnection();
    
    // Periodically test Redis connection to recover from failures
    setInterval(() => {
      if (this.redisFailure) {
        this.testRedisConnection();
      }
    }, 10000); // Test every 10 seconds when Redis is failing
    
    // Periodic sync to Redis (memory-first approach)
    setInterval(() => {
      this.periodicSyncToRedis();
    }, 30000); // Sync every 30 seconds
  }

  public async testRedisConnection(): Promise<void> {
    try {
      // Add timeout for ping operation
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Redis ping timeout')), 2000);
      });
      
      await Promise.race([this.redis.ping(), timeoutPromise]);
      
      if (this.redisFailure) {
        console.log('[PROGRESS] ✅ Redis connection recovered');
        // Sync memory cache to Redis (run in background, don't block)
        this.syncMemoryToRedis().catch(error => {
          console.warn('[PROGRESS] ⚠️ Failed to sync memory to Redis:', error.message);
        });
      } else {
        console.log('[PROGRESS] ✅ Redis connection successful');
      }
      this.redisFailure = false;
    } catch (error) {
      if (!this.redisFailure) {
        console.warn('[PROGRESS] ⚠️ Redis connection failed, using in-memory fallback');
      }
      this.redisFailure = true;
    }
  }

  /**
   * Create a new progress tracking job
   */
  async createJob(
    jobId: string, 
    totalItems: number, 
    metadata?: ProgressMetadata
  ): Promise<void> {
    const progress: ProgressStatus = {
      jobId,
      totalItems,
      completed: 0,
      percentage: 0,
      startTime: new Date(),
      metadata,
      status: 'pending',
      subTasks: {}
    };

    try {
      await this.saveProgress(progress);
      
      logger.logProgress('create', true, {
        jobId,
        totalItems,
        type: metadata?.type,
        userId: metadata?.userId
      });
    } catch (error) {
      // Log error but don't throw - we don't want to fail the job if Redis is having issues
      logger.logError('Failed to create progress job', error as Error, { jobId });
      console.warn(`[PROGRESS] Failed to create progress job ${jobId}:`, (error as Error).message);
    }
  }

  /**
   * Update progress for a job
   */
  async updateProgress(
    jobId: string, 
    completed: number, 
    currentAction?: string
  ): Promise<void> {
    try {
      const progress = await this.getProgress(jobId);
      if (!progress) {
        console.warn(`[PROGRESS] Progress job ${jobId} not found for update`);
        return; // Don't throw error, just return
      }

      progress.completed = Math.min(completed, progress.totalItems);
      progress.percentage = Math.round((progress.completed / progress.totalItems) * 100);
      progress.currentAction = currentAction;
      progress.status = progress.completed >= progress.totalItems ? 'completed' : 'running';
      
      // Calculate estimated end time
      if (progress.completed > 0 && progress.status === 'running') {
        const elapsed = Date.now() - progress.startTime.getTime();
        const rate = progress.completed / elapsed;
        const remaining = progress.totalItems - progress.completed;
        progress.estimatedEndTime = new Date(Date.now() + (remaining / rate));
      }

      await this.saveProgress(progress);
      this.notifySubscribers(jobId, progress);

      logger.logProgress('update', true, {
        jobId,
        completed,
        percentage: progress.percentage,
        currentAction
      });
    } catch (error) {
      // Log error but don't throw - we don't want to fail the job if Redis is having issues
      logger.logError('Failed to update progress', error as Error, { jobId });
      console.warn(`[PROGRESS] Failed to update progress for ${jobId}:`, (error as Error).message);
    }
  }

  /**
   * Add a sub-task to track nested progress
   */
  async addSubTask(
    jobId: string, 
    subTaskId: string, 
    weight: number,
    total: number = 100
  ): Promise<void> {
    try {
      const progress = await this.getProgress(jobId);
      if (!progress) {
        console.warn(`[PROGRESS] Progress job ${jobId} not found for sub-task`);
        return; // Don't throw error, just return
      }

      progress.subTasks![subTaskId] = {
        subTaskId,
        weight,
        completed: 0,
        total,
        status: 'pending'
      };

      await this.saveProgress(progress);
    } catch (error) {
      // Log error but don't throw
      console.warn(`[PROGRESS] Failed to add sub-task ${subTaskId} to ${jobId}:`, (error as Error).message);
    }
  }

  /**
   * Update sub-task progress
   */
  async updateSubTask(
    jobId: string, 
    subTaskId: string, 
    completed: number
  ): Promise<void> {
    try {
      const progress = await this.getProgress(jobId);
      if (!progress || !progress.subTasks![subTaskId]) {
        console.warn(`[PROGRESS] Sub-task ${subTaskId} not found in job ${jobId}`);
        return; // Don't throw error, just return
      }

      const subTask = progress.subTasks![subTaskId];
      subTask.completed = Math.min(completed, subTask.total);
      subTask.status = subTask.completed >= subTask.total ? 'completed' : 'running';

      // Calculate overall progress including sub-tasks
      const subTaskProgress = Object.values(progress.subTasks!).reduce((sum, task) => {
        return sum + (task.completed / task.total) * (task.weight / 100);
      }, 0);

      // Update main progress to include sub-task contributions
      progress.completed = Math.min(progress.completed + subTaskProgress, progress.totalItems);
      progress.percentage = Math.round((progress.completed / progress.totalItems) * 100);

      await this.saveProgress(progress);
      this.notifySubscribers(jobId, progress);
    } catch (error) {
      // Log error but don't throw
      console.warn(`[PROGRESS] Failed to update sub-task ${subTaskId} in ${jobId}:`, (error as Error).message);
    }
  }

  /**
   * Complete a job successfully
   */
  async completeJob(jobId: string, result?: JobResult): Promise<void> {
    const progress = await this.getProgress(jobId);
    if (!progress) {
      throw new Error(`Progress job ${jobId} not found`);
    }

    progress.completed = progress.totalItems;
    progress.percentage = 100;
    progress.status = 'completed';
    progress.result = result;
    progress.estimatedEndTime = new Date();

    await this.saveProgress(progress);
    this.notifySubscribers(jobId, progress);

    logger.logProgress('complete', true, {
      jobId,
      duration: Date.now() - progress.startTime.getTime(),
      result: result?.success
    });
  }

  /**
   * Fail a job with error
   */
  async failJob(jobId: string, error: Error): Promise<void> {
    const progress = await this.getProgress(jobId);
    if (!progress) {
      throw new Error(`Progress job ${jobId} not found`);
    }

    progress.status = 'failed';
    progress.error = error;

    await this.saveProgress(progress);
    this.notifySubscribers(jobId, progress);

    logger.logProgress('fail', false, {
      jobId,
      error: error.message,
      duration: Date.now() - progress.startTime.getTime()
    });
  }

  /**
   * Get current progress status
   */
  async getProgress(jobId: string): Promise<ProgressStatus | null> {
    // Use memory fallback first if Redis has failed recently
    if (this.redisFailure) {
      return this.memoryCache.get(jobId) || null;
    }
    
    try {
      // Add timeout wrapper to prevent hanging
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Redis operation timeout')), 3000); // 3 second timeout
      });
      
      const redisOperation = async () => {
        const key = this.getRedisKey(jobId);
        const data = await this.redis.get(key);
        
        if (!data) {
          return null;
        }

        const progress = JSON.parse(data);
        // Convert date strings back to Date objects
        progress.startTime = new Date(progress.startTime);
        if (progress.estimatedEndTime) {
          progress.estimatedEndTime = new Date(progress.estimatedEndTime);
        }

        return progress;
      };
      
      // Race between Redis operation and timeout
      const result = await Promise.race([redisOperation(), timeoutPromise]);
      
      // If we got here, Redis is working again
      this.redisFailure = false;
      return result;
      
    } catch (error) {
      // Fallback to memory on Redis error
      console.warn('[PROGRESS] Redis get failed, using memory fallback');
      this.redisFailure = true;
      return this.memoryCache.get(jobId) || null;
    }
  }

  /**
   * Subscribe to progress updates
   */
  subscribeToProgress(jobId: string, callback: ProgressCallback): string {
    if (!this.subscribers.has(jobId)) {
      this.subscribers.set(jobId, new Set());
    }
    
    this.subscribers.get(jobId)!.add(callback);
    
    // Return subscription ID for unsubscribing
    const subscriptionId = `${jobId}:${Date.now()}:${Math.random()}`;
    
    return subscriptionId;
  }

  /**
   * Unsubscribe from progress updates
   */
  unsubscribe(subscriptionId: string): void {
    const [jobId] = subscriptionId.split(':');
    const subscribers = this.subscribers.get(jobId);
    
    if (subscribers) {
      // In a real implementation, you'd track the callback by subscription ID
      // For now, we'll clear all subscribers for this job
      subscribers.clear();
      if (subscribers.size === 0) {
        this.subscribers.delete(jobId);
      }
    }
  }

  /**
   * Get all active progress jobs for a user
   */
  async getUserProgress(userId: string): Promise<ProgressStatus[]> {
    // Always use memory fallback first if Redis has failed recently
    if (this.redisFailure) {
      const progressList: ProgressStatus[] = [];
      for (const [jobId, progress] of this.memoryCache.entries()) {
        if (progress.metadata?.userId === userId) {
          progressList.push(progress);
        }
      }
      return progressList;
    }
    
    try {
      // Add timeout wrapper to prevent hanging
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Redis operation timeout')), 5000); // 5 second timeout
      });
      
      const redisOperation = async () => {
        const pattern = `${this.KEY_PREFIX}*`;
        const keys = await this.redis.keys(pattern);
        const progressList: ProgressStatus[] = [];

        for (const key of keys) {
          const data = await this.redis.get(key);
          if (data) {
            const progress = JSON.parse(data);
            if (progress.metadata?.userId === userId) {
              progress.startTime = new Date(progress.startTime);
              if (progress.estimatedEndTime) {
                progress.estimatedEndTime = new Date(progress.estimatedEndTime);
              }
              progressList.push(progress);
            }
          }
        }

        return progressList;
      };
      
      // Race between Redis operation and timeout
      const result = await Promise.race([redisOperation(), timeoutPromise]);
      
      // If we got here, Redis is working again
      this.redisFailure = false;
      return result;
      
    } catch (error) {
      console.warn('[PROGRESS] Redis getUserProgress failed, using memory fallback');
      this.redisFailure = true;
      
      // Fallback to memory
      const progressList: ProgressStatus[] = [];
      for (const [jobId, progress] of this.memoryCache.entries()) {
        if (progress.metadata?.userId === userId) {
          progressList.push(progress);
        }
      }
      return progressList;
    }
  }

  /**
   * Cancel a running job
   */
  async cancelJob(jobId: string): Promise<void> {
    const progress = await this.getProgress(jobId);
    if (!progress) {
      throw new Error(`Progress job ${jobId} not found`);
    }

    progress.status = 'cancelled';
    await this.saveProgress(progress);
    this.notifySubscribers(jobId, progress);

    logger.logProgress('cancel', true, { jobId });
  }

  // =============================================
  // Private Methods
  // =============================================

  private async saveProgress(progress: ProgressStatus): Promise<void> {
    // Memory-first approach: ALWAYS save to memory immediately
    this.memoryCache.set(progress.jobId, progress);
    
    // Mark as needing sync to Redis (will be synced periodically)
    this.syncedToRedis.delete(progress.jobId);
    
    // Redis sync happens periodically in background, not on every save
    // This eliminates blocking operations and timeout cascades
  }

  private notifySubscribers(jobId: string, progress: ProgressStatus): void {
    const subscribers = this.subscribers.get(jobId);
    if (subscribers) {
      subscribers.forEach(callback => {
        try {
          callback(progress);
        } catch (error) {
          logger.logError('Progress callback error', error as Error, { jobId });
        }
      });
    }

    // Emit event for other listeners
    this.emit('progress', progress);
  }

  private getRedisKey(jobId: string): string {
    return `${this.KEY_PREFIX}${jobId}`;
  }

  private setupCleanup(): void {
    // Clean up expired subscribers periodically
    setInterval(() => {
      this.cleanupExpiredJobs();
    }, 300000); // Every 5 minutes
    
    // Clean up completed/old progress entries from memory
    setInterval(() => {
      this.cleanupMemoryCache();
    }, 600000); // Every 10 minutes
  }

  private async cleanupExpiredJobs(): Promise<void> {
    try {
      const pattern = `${this.KEY_PREFIX}*`;
      const keys = await this.redis.keys(pattern);
      
      for (const key of keys) {
        const ttl = await this.redis.ttl(key);
        if (ttl <= 0) {
          const jobId = key.replace(this.KEY_PREFIX, '');
          this.subscribers.delete(jobId);
        }
      }
    } catch (error) {
      logger.logError('Progress cleanup error', error as Error);
    }
  }

  private cleanupMemoryCache(): void {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000); // 1 hour ago
    
    let cleaned = 0;
    
    for (const [jobId, progress] of this.memoryCache.entries()) {
      // Clean up completed jobs older than 1 hour
      const isOld = progress.startTime.getTime() < oneHourAgo;
      const isCompleted = ['completed', 'failed', 'cancelled'].includes(progress.status);
      
      if (isOld && isCompleted) {
        this.memoryCache.delete(jobId);
        this.syncedToRedis.delete(jobId);
        this.subscribers.delete(jobId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[PROGRESS] 🧹 Cleaned up ${cleaned} old progress entries from memory`);
    }
  }

  /**
   * Periodic sync to Redis (memory-first approach)
   */
  private async periodicSyncToRedis(): Promise<void> {
    // Skip if Redis is failing
    if (this.redisFailure) {
      return;
    }

    // Find items that need syncing
    const toSync = Array.from(this.memoryCache.entries()).filter(
      ([jobId, progress]) => !this.syncedToRedis.has(jobId)
    );

    if (toSync.length === 0) {
      return;
    }

    console.log(`[PROGRESS] 🔄 Periodic sync: ${toSync.length} items to Redis`);
    
    let synced = 0;
    let failed = 0;

    for (const [jobId, progress] of toSync) {
      try {
        const key = this.getRedisKey(jobId);
        await this.redis.setex(key, this.PROGRESS_TTL, JSON.stringify(progress));
        this.syncedToRedis.add(jobId);
        synced++;
      } catch (error) {
        failed++;
        console.warn(`[PROGRESS] Failed to sync ${jobId} to Redis:`, (error as Error).message);
        // Mark Redis as failing if we get timeouts
        if ((error as Error).message.includes('timeout')) {
          this.redisFailure = true;
          break;
        }
      }
    }

    this.lastSyncTime = Date.now();
    console.log(`[PROGRESS] ✅ Periodic sync complete: ${synced} synced, ${failed} failed`);
  }

  /**
   * Sync memory cache to Redis when connection recovers (one-time full sync)
   */
  private async syncMemoryToRedis(): Promise<void> {
    if (this.memoryCache.size === 0) {
      return;
    }

    console.log(`[PROGRESS] 🔄 Recovery sync: ${this.memoryCache.size} progress entries to Redis`);
    
    let synced = 0;
    let failed = 0;

    for (const [jobId, progress] of this.memoryCache.entries()) {
      try {
        const key = this.getRedisKey(jobId);
        await this.redis.setex(key, this.PROGRESS_TTL, JSON.stringify(progress));
        this.syncedToRedis.add(jobId);
        synced++;
      } catch (error) {
        failed++;
        console.warn(`[PROGRESS] Failed to sync ${jobId} to Redis:`, (error as Error).message);
      }
    }

    this.lastSyncTime = Date.now();
    console.log(`[PROGRESS] ✅ Recovery sync complete: ${synced} synced, ${failed} failed`);
  }

  /**
   * Get sync status for monitoring
   */
  getSyncStatus(): { 
    totalInMemory: number; 
    pendingSync: number; 
    synced: number; 
    lastSyncTime: number; 
    redisFailure: boolean 
  } {
    const pendingSync = Array.from(this.memoryCache.keys()).filter(
      jobId => !this.syncedToRedis.has(jobId)
    ).length;
    
    return {
      totalInMemory: this.memoryCache.size,
      pendingSync,
      synced: this.syncedToRedis.size,
      lastSyncTime: this.lastSyncTime,
      redisFailure: this.redisFailure
    };
  }

  /**
   * Clean shutdown
   */
  async shutdown(): Promise<void> {
    this.subscribers.clear();
    this.removeAllListeners();
  }
}

// =============================================
// Singleton Instance
// =============================================

export const progressBroadcaster = new ProgressBroadcaster(); 