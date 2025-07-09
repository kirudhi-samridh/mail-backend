import { Worker, Job } from 'bullmq';
import { getRedisConnection } from '../../redis/connection';
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';
import { io } from '../../../email-sync-proxy-service/src/app';

const queueName = 'email-summarization';

const AI_SERVICE_URL = `http://localhost:${process.env.AI_SERVICE_PORT || 3004}`;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// The processor function that will be called for each job
const processJob = async (job: Job) => {
  const { emailId, userId } = job.data;
  console.log(`[WORKER] Processing job ${job.id} for email ${emailId} and user ${userId}`);

  try {
    // We need a valid JWT to authenticate with the AI service
    const token = jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '5m' });

    const response = await fetch(`${AI_SERVICE_URL}/api/emails/${emailId}/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`AI service failed for job ${job.id}: ${response.status} ${errorData}`);
    }

    const result = await response.json();
    console.log(`[WORKER] Successfully completed job ${job.id} for email ${emailId}.`);
    
    // Notify frontend via WebSocket that summary for emailId is ready
    io.to(userId).emit('summary-complete', { 
      emailId, 
      summary: result 
    });
    console.log(`[WORKER] Emitted 'summary-complete' event to user ${userId} for email ${emailId}`);

    return result;
  } catch (error: any) {
    console.error(`[WORKER] Error processing job ${job.id} for email ${emailId}:`, error.message);
    // The error will be caught by BullMQ and the job will be retried if configured
    throw error;
  }
};

// Create a new worker instance
export const summaryWorker = new Worker(queueName, processJob, {
  connection: getRedisConnection(),
  concurrency: 5, // Process up to 5 jobs concurrently
  limiter: { // Limit to 100 jobs every 10 seconds to avoid overwhelming the AI service
    max: 100,
    duration: 10000,
  },
});

summaryWorker.on('completed', (job, result) => {
  console.log(`[WORKER] Job ${job.id} has completed successfully.`);
});

summaryWorker.on('failed', (job, err) => {
  console.error(`[WORKER] Job ${job?.id} has failed with error: ${err.message}`);
});

console.log('[WORKER] AI Summary Processor worker started.'); 