import { Queue } from 'bullmq';
import { getRedisConnection } from '../redis/connection';

const queueName = 'email-summarization';

// Create a new queue instance with the shared Redis connection.
// The connection is lazily created, so it's safe to call this at the module level.
export const summaryQueue = new Queue(queueName, {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3, // Retry a job up to 3 times if it fails
    backoff: {
      type: 'exponential',
      delay: 1000, // Start with a 1-second delay
    },
    removeOnComplete: true, // Remove jobs from the queue once they are completed
    removeOnFail: {
      count: 1000, // Keep the last 1000 failed jobs for inspection
    },
  },
});

console.log(`[QUEUE] Initialized queue: ${queueName}`); 