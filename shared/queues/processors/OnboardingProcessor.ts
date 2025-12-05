import { Job } from 'bullmq';
import { OnboardingJobData, BulkEmailFetchJobData } from '../types/onboarding-jobs';
import { queueRegistry } from '../core/QueueRegistry';
import { progressBroadcaster } from '../../services/ProgressBroadcaster';

export class OnboardingProcessor {
  async process(job: Job<OnboardingJobData>): Promise<void> {
    const { accountId, fetchDays, summaryDays, emailAddress, userToken, metadata } = job.data;
    const { correlationId } = metadata;

    console.log(`[ONBOARDING] 🚀 Starting onboarding for account ${accountId} (${emailAddress})`);

    try {
      // Initialize progress tracking (wait for it to complete)
      console.log(`[ONBOARDING] 📊 Creating progress tracking for ${correlationId}`);
      await progressBroadcaster.createJob(
        correlationId,
        100, // Total progress units
        {
          type: 'onboarding',
          description: `Onboarding ${emailAddress}`,
          userId: job.data.userId || 'unknown'
        }
      );
      console.log(`[ONBOARDING] ✅ Progress tracking created for ${correlationId}`);

      // Estimate total emails (rough calculation: 10 emails per day average)
      const estimatedEmails = fetchDays * 10;
      const batchSize = 50; // Gmail API batch size
      const totalBatches = Math.ceil(estimatedEmails / batchSize);

      console.log(`[ONBOARDING] 📧 Estimated ${estimatedEmails} emails in ${totalBatches} batches`);

      // Add sub-tasks (wait for completion)
      await progressBroadcaster.addSubTask(correlationId, 'email-fetch', 50, totalBatches);
      await progressBroadcaster.addSubTask(correlationId, 'ai-summary', 50, estimatedEmails);
      console.log(`[ONBOARDING] 📋 Sub-tasks added: email-fetch (${totalBatches}), ai-summary (${estimatedEmails})`);

      // Get email processing queue
      const emailQueue = queueRegistry.get('email-processing');
      if (!emailQueue) {
        throw new Error('Email processing queue not found');
      }

      // Create batch fetch jobs
      const batchJobs: BulkEmailFetchJobData[] = [];
      
      for (let batchNumber = 1; batchNumber <= totalBatches; batchNumber++) {
        batchJobs.push({
          accountId,
          batchSize,
          fetchDays,
          summaryDays,
          userToken, // Pass the user's JWT token
          metadata: {
            correlationId,
            batchNumber,
            totalBatches
          }
        });
      }

      // Queue all batch jobs
      const promises = batchJobs.map(jobData => 
        emailQueue.addJob('bulk-email-fetch', jobData, {
          priority: 5,
          attempts: 3
        })
      );

      await Promise.all(promises);
      console.log(`[ONBOARDING] 🎯 Queued ${totalBatches} batch jobs for account ${accountId}`);

      // Update progress (wait for completion)
      await progressBroadcaster.updateProgress(correlationId, 10, `Queued ${totalBatches} fetch batches`);
      console.log(`[ONBOARDING] ✅ Progress updated: 10% complete`);

    } catch (error) {
      console.error(`[ONBOARDING] ❌ Error processing account ${accountId}:`, (error as Error).message);
      
      // Try to mark progress as failed
      try {
        await progressBroadcaster.failJob(correlationId, error as Error);
      } catch (progressError) {
        console.warn(`[ONBOARDING] ⚠️ Failed to update progress with error:`, (progressError as Error).message);
      }
      
      throw error;
    }
  }
} 