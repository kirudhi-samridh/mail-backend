/**
 * Universal Queue System - Queue Factory
 * 
 * Factory pattern for creating queues with proper configuration.
 * Handles queue creation, configuration management, and automatic registration
 * with the queue registry.
 */

import { 
  IQueueFactory, 
  IUniversalQueue, 
  QueueConfig, 
  QueueType 
} from '../types/interfaces';
import { 
  getBaseQueueConfig, 
  mergeQueueConfig, 
  getEnvironmentConfig,
  createConfigWithConnection 
} from '../types/queue-configs';
import { UniversalQueue } from './UniversalQueue';
import { queueRegistry } from './QueueRegistry';

/**
 * Factory Configuration Options
 */
export interface FactoryOptions {
  autoRegister?: boolean;
  environment?: 'development' | 'test' | 'production' | 'auto';
  globalDefaults?: Partial<QueueConfig>;
}

/**
 * Queue Factory Implementation
 */
export class QueueFactory implements IQueueFactory {
  private createdQueues = new Map<string, IUniversalQueue>();
  private options: FactoryOptions;

  constructor(options: FactoryOptions = {}) {
    this.options = {
      autoRegister: true,
      environment: 'auto',
      ...options
    };
  }

  /**
   * Create a generic queue with optional configuration
   */
  create<T = any>(name: string, config?: QueueConfig): IUniversalQueue<T> {
    if (this.createdQueues.has(name)) {
      throw new Error(`Queue '${name}' already exists`);
    }

    const finalConfig = config || getBaseQueueConfig();
    
    // Apply global defaults if specified
    const effectiveConfig = this.options.globalDefaults 
      ? mergeQueueConfig({ ...finalConfig, ...this.options.globalDefaults })
      : finalConfig;

    const queue = new UniversalQueue<T>(name, effectiveConfig);
    
    this.createdQueues.set(name, queue);
    
    if (this.options.autoRegister) {
      queueRegistry.register(name, queue);
    }

    return queue;
  }

  /**
   * Get an existing queue
   */
  get<T = any>(name: string): IUniversalQueue<T> | undefined {
    return this.createdQueues.get(name) as IUniversalQueue<T>;
  }

  /**
   * List all created queues
   */
  list(): string[] {
    return Array.from(this.createdQueues.keys());
  }

  /**
   * Create multiple queues in batch
   */
  createBatch(
    queueDefinitions: Array<{
      name: string;
      config?: QueueConfig;
    }>,
    options: { throwOnError?: boolean } = {}
  ): Map<string, IUniversalQueue> {
    const createdQueues = new Map<string, IUniversalQueue>();
    const errors: Array<{ name: string; error: Error }> = [];

    for (const definition of queueDefinitions) {
      try {
        const queue = this.create(definition.name, definition.config);
        createdQueues.set(definition.name, queue);
      } catch (error) {
        errors.push({ name: definition.name, error: error as Error });
        if (options.throwOnError) {
          throw error;
        }
      }
    }

    if (errors.length > 0 && !options.throwOnError) {
      console.warn(`[QueueFactory] ${errors.length} queues failed to create in batch:`, 
        errors.map(e => `${e.name}: ${e.error.message}`));
    }
    
    return createdQueues;
  }

  /**
   * Destroy a specific queue
   */
  async destroy(name: string): Promise<void> {
    const queue = this.createdQueues.get(name);
    if (!queue) {
      console.warn(`[QueueFactory] Attempted to destroy non-existent queue: ${name}`);
      return;
    }

    try {
      if (typeof (queue as any).close === 'function') {
        await (queue as any).close();
      }
      
      if (this.options.autoRegister) {
        queueRegistry.unregister(name);
      }
      
      this.createdQueues.delete(name);
      
      console.log(`[QueueFactory] Destroyed queue: ${name}`);
    } catch (error) {
      console.error(`[QueueFactory] Failed to destroy queue ${name}:`, error);
      throw error;
    }
  }

  /**
   * Destroy all created queues
   */
  async destroyAll(): Promise<void> {
    const queueNames = this.list();
    
    console.log(`[QueueFactory] Destroying ${queueNames.length} queues...`);
    
    const destroyPromises = queueNames.map(name => 
      this.destroy(name).catch(error => {
        console.error(`[QueueFactory] Failed to destroy queue ${name}:`, error);
        return Promise.resolve();
      })
    );

    await Promise.all(destroyPromises);
    
    console.log('[QueueFactory] All queues destroyed');
  }

  /**
   * Update factory options
   */
  updateOptions(newOptions: Partial<FactoryOptions>): void {
    this.options = { ...this.options, ...newOptions };
    console.log('[QueueFactory] Updated factory options');
  }

  /**
   * Get current factory options
   */
  getOptions(): FactoryOptions {
    return { ...this.options };
  }

  /**
   * Get factory statistics
   */
  getFactoryStats(): {
    totalQueues: number;
    autoRegisterEnabled: boolean;
    environment: string;
  } {
    return {
      totalQueues: this.createdQueues.size,
      autoRegisterEnabled: this.options.autoRegister || false,
      environment: this.options.environment || 'auto',
    };
  }
}

// =============================================
// Singleton Instance
// =============================================

/**
 * Global queue factory instance
 */
export const queueFactory = new QueueFactory();

/**
 * Helper function to get the global queue factory
 */
export function getQueueFactory(): QueueFactory {
  return queueFactory;
}

/**
 * Quick function to create a queue
 */
export function createQueue<T = any>(
  name: string, 
  config?: QueueConfig
): IUniversalQueue<T> {
  return queueFactory.create<T>(name, config);
}

/**
 * Quick function to get an existing queue
 */
export function getQueue<T = any>(name: string): IUniversalQueue<T> | undefined {
  return queueFactory.get<T>(name);
} 