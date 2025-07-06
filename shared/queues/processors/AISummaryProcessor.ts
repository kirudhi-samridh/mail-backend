import fetch from 'node-fetch';
import { eq } from 'drizzle-orm';
import { Job } from 'bullmq';
import { AISummaryJobData } from '../types/onboarding-jobs';
import { progressBroadcaster } from '../../services/ProgressBroadcaster';
import { getDb, emails } from '../../db/connection';

export class AISummaryProcessor {
  private db = getDb();

  async process(job: Job<AISummaryJobData>): Promise<void> {
    const { emailId, userToken, metadata } = job.data;
    const { correlationId } = metadata;

    try {
      // Get email data
      const [email] = await this.db
        .select()
        .from(emails)
        .where(eq(emails.id, emailId))
        .limit(1);

      if (!email) {
        throw new Error(`Email not found: ${emailId}`);
      }

      // Call AI service for summary
      const summary = await this.generateSummary(email, userToken);

      // Update email with summary
      await this.db
        .update(emails)
        .set({ 
          summary,
          processingStatus: 'completed',
          updatedAt: new Date()
        })
        .where(eq(emails.id, emailId));

      // Update progress - increment by 1 (since we processed 1 email)
      // Note: We need to track the current progress ourselves since incrementSubTask doesn't exist
      // For now, we'll use a simple approach and update progress
      const currentProgress = await progressBroadcaster.getProgress(correlationId);
      if (currentProgress?.subTasks?.['ai-summary']) {
        const subTask = currentProgress.subTasks['ai-summary'];
        const newCompleted = subTask.completed + 1;
        await progressBroadcaster.updateSubTask(correlationId, 'ai-summary', newCompleted);
      }

    } catch (error) {
      // Mark email as failed
      await this.db
        .update(emails)
        .set({ 
          processingStatus: 'failed',
          updatedAt: new Date()
        })
        .where(eq(emails.id, emailId));

      throw error;
    }
  }

  private async generateSummary(email: any, userToken?: string): Promise<string> {
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:3004';
    
    try {
      // Use the user's JWT token for authentication
      if (!userToken) {
        throw new Error('No user token available for AI service authentication');
      }
      
      const response = await fetch(`${AI_SERVICE_URL}/api/emails/${email.id}/summarize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userToken}`,
        },
        body: JSON.stringify({
          subject: email.subject,
          bodyText: email.bodyText,
          bodyHtml: email.bodyHtml,
          fromAddress: email.fromAddress,
          receivedAt: email.receivedAt,
          // Include the full email body for AI processing
          body: email.bodyHtml || email.bodyText || email.snippet
        })
      });

      if (!response.ok) {
        throw new Error(`AI service responded with status: ${response.status}`);
      }

      const result = await response.json();
      return result.summary || 'Summary generation failed';

    } catch (error) {
      console.error('Error generating summary:', error);
      throw new Error(`Failed to generate summary: ${(error as Error).message}`);
    }
  }
} 