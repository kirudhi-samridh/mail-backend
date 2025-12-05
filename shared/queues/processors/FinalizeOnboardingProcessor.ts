import { eq } from 'drizzle-orm';
import { Job } from 'bullmq';
import { FinalizeOnboardingJobData } from '../types/onboarding-jobs';
import { progressBroadcaster } from '../../services/ProgressBroadcaster';
import { getDb, users, emailAccounts } from '../../db/connection';

export class FinalizeOnboardingProcessor {
  private db = getDb();

  async process(job: Job<FinalizeOnboardingJobData>): Promise<void> {
    const { accountId, metadata } = job.data;
    const { correlationId, totalEmailsFetched, totalSummariesGenerated } = metadata;

    try {
      // Get the user ID from the email account
      const [emailAccount] = await this.db
        .select({ userId: emailAccounts.userId })
        .from(emailAccounts)
        .where(eq(emailAccounts.id, accountId))
        .limit(1);

      if (!emailAccount) {
        throw new Error(`Email account not found: ${accountId}`);
      }

      // Mark user onboarding as completed
      await this.db
        .update(users)
        .set({ onboardingCompleted: true })
        .where(eq(users.id, emailAccount.userId));

      // Complete progress tracking
      await progressBroadcaster.completeJob(
        correlationId,
        {
          success: true,
          summary: `Onboarding complete! Fetched ${totalEmailsFetched} emails and generated ${totalSummariesGenerated} summaries.`,
          data: {
            totalEmailsFetched,
            totalSummariesGenerated
          }
        }
      );

    } catch (error) {
      await progressBroadcaster.failJob(correlationId, error as Error);
      throw error;
    }
  }
} 