import { queueRegistry } from '../core/QueueRegistry';
import { queueFactory } from '../core/QueueFactory';
import { OnboardingProcessor, BulkEmailFetchProcessor, AISummaryProcessor, FinalizeOnboardingProcessor } from '../index';
import { mergeQueueConfig } from '../types/queue-configs';

export async function setupOnboardingQueues() {
  console.log('[QUEUE_SETUP] Setting up onboarding queues...');

  try {
    // Create onboarding queue
    const onboardingQueue = queueFactory.create('onboarding', mergeQueueConfig({
      concurrency: 1,
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 50,
        attempts: 3
      }
    }));

    // Create email processing queue
    const emailProcessingQueue = queueFactory.create('email-processing', mergeQueueConfig({
      concurrency: 5,
      defaultJobOptions: {
        removeOnComplete: 5,
        removeOnFail: 20,
        attempts: 3
      }
    }));

    // Create AI processing queue
    const aiProcessingQueue = queueFactory.create('ai-processing', mergeQueueConfig({
      concurrency: 3,
      defaultJobOptions: {
        removeOnComplete: 5,
        removeOnFail: 20,
        attempts: 2
      }
    }));

    // Register queues in registry
    queueRegistry.register('onboarding', onboardingQueue);
    queueRegistry.register('email-processing', emailProcessingQueue);
    queueRegistry.register('ai-processing', aiProcessingQueue);

    // Set up workers for each queue
    const onboardingProcessor = new OnboardingProcessor();
    const bulkEmailFetchProcessor = new BulkEmailFetchProcessor();
    const finalizeOnboardingProcessor = new FinalizeOnboardingProcessor();

    // Create workers with processor functions
    onboardingQueue.createWorker(async (job) => {
      if (job.name === 'onboarding') {
        return await onboardingProcessor.process(job);
      } else if (job.name === 'finalize-onboarding') {
        return await finalizeOnboardingProcessor.process(job);
      }
      throw new Error(`Unknown job type: ${job.name}`);
    });
    
    emailProcessingQueue.createWorker(async (job) => {
      return await bulkEmailFetchProcessor.process(job);
    });

    console.log('[QUEUE_SETUP] ✅ Onboarding queues and workers initialized successfully');
    
    return {
      onboardingQueue,
      emailProcessingQueue,
      aiProcessingQueue
    };

  } catch (error) {
    console.error('[QUEUE_SETUP] ❌ Error setting up onboarding queues:', error);
    throw error;
  }
}

export async function shutdownOnboardingQueues() {
  console.log('[QUEUE_SETUP] Shutting down onboarding queues...');
  
  try {
    const queues = ['onboarding', 'email-processing', 'ai-processing'];
    
    for (const queueName of queues) {
      const queue = queueRegistry.get(queueName);
      if (queue) {
        await queue.close();
        console.log(`[QUEUE_SETUP] ✅ Closed ${queueName} queue`);
      }
    }
    
    console.log('[QUEUE_SETUP] ✅ All onboarding queues shut down successfully');
  } catch (error) {
    console.error('[QUEUE_SETUP] ❌ Error shutting down queues:', error);
    throw error;
  }
} 