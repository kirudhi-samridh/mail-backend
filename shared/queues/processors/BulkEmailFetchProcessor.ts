import { google } from 'googleapis';
import { eq } from 'drizzle-orm';
import { Job } from 'bullmq';
import { BulkEmailFetchJobData, AISummaryJobData } from '../types/onboarding-jobs';
import { queueRegistry } from '../core/QueueRegistry';
import { progressBroadcaster } from '../../services/ProgressBroadcaster';
import { getDb, emailAccounts, emails, type NewEmail } from '../../db/connection';

export class BulkEmailFetchProcessor {
  private db = getDb();

  async process(job: Job<BulkEmailFetchJobData>): Promise<void> {
    const { accountId, batchSize, pageToken, fetchDays, summaryDays, userToken, metadata } = job.data;
    const { correlationId, batchNumber } = metadata;

    try {
      // Get Gmail client for this account
      const gmail = await this.getGmailClient(accountId);
      
      // Calculate date range for fetching - use start of day for consistent boundaries
      const afterDate = new Date();
      afterDate.setDate(afterDate.getDate() - fetchDays);
      afterDate.setHours(0, 0, 0, 0); // Start of day in server timezone
      
      // Format date for Gmail API (YYYY/MM/DD format is more reliable than timestamps)
      const afterDateStr = afterDate.toISOString().split('T')[0].replace(/-/g, '/');
      
      console.log(`[BULK_EMAIL_FETCH] Fetching emails from ${afterDateStr} onwards for account ${accountId}`);

      // Fetch message list using date format (more reliable than timestamp)
      const response = await gmail.users.messages.list({
        userId: 'me',
        maxResults: batchSize,
        pageToken,
        q: `after:${afterDateStr}` // Gmail search query with date format
      });

      const messages = response.data.messages || [];
      
      if (messages.length === 0) {
        await progressBroadcaster.updateSubTask(correlationId, 'email-fetch', batchNumber);
        return;
      }

      // Fetch full message details
      const emailPromises = messages.map(msg => 
        gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'full'
        })
      );

      const fullMessages = await Promise.all(emailPromises);
      
      // Process and store emails
      const newEmails: NewEmail[] = [];
      const summaryJobs: AISummaryJobData[] = [];

      for (const msg of fullMessages) {
        const emailData = this.processEmailMessage(msg.data, accountId);
        const [insertedEmail] = await this.db.insert(emails).values(emailData).returning({ id: emails.id });
        
        // Check if email is within summary range - use start of day for consistent boundaries
        const emailDate = new Date(emailData.receivedAt!);
        const summaryRange = new Date();
        summaryRange.setDate(summaryRange.getDate() - summaryDays);
        summaryRange.setHours(0, 0, 0, 0); // Start of day in server timezone
        
        if (emailDate >= summaryRange) {
          summaryJobs.push({
            emailId: insertedEmail.id,
            userToken, // Pass the user's JWT token
            metadata: { correlationId }
          });
        }
      }

      // Queue AI summary jobs for eligible emails
      if (summaryJobs.length > 0) {
        const aiQueue = queueRegistry.get('ai-processing');
        if (aiQueue) {
          const summaryPromises = summaryJobs.map(jobData =>
            aiQueue.addJob('ai-summary', jobData, {
              priority: 3,
              attempts: 2
            })
          );
          await Promise.all(summaryPromises);
        }
      }

      // Update progress
      await progressBroadcaster.updateSubTask(correlationId, 'email-fetch', batchNumber);

      // Queue next batch if there are more messages
      if (response.data.nextPageToken) {
        const emailQueue = queueRegistry.get('email-processing');
        if (emailQueue) {
          await emailQueue.addJob('bulk-email-fetch', {
            ...job.data,
            pageToken: response.data.nextPageToken,
            userToken, // Ensure user token is passed to next batch
            metadata: {
              ...metadata,
              batchNumber: batchNumber + 1
            }
          });
        }
      }

    } catch (error) {
      // Log error and update progress (simplified approach)
      console.error(`[BULK_EMAIL_FETCH] Error in batch ${batchNumber}:`, (error as Error).message);
      // Note: ProgressBroadcaster doesn't have markSubTaskFailed, so we just log for now
      throw error;
    }
  }

  private async getGmailClient(accountId: string) {
    const [emailAccount] = await this.db
      .select({ 
        refreshToken: emailAccounts.refreshToken,
        emailAddress: emailAccounts.emailAddress,
        createdAt: emailAccounts.createdAt 
      })
      .from(emailAccounts)
      .where(eq(emailAccounts.id, accountId))
      .limit(1);

    if (!emailAccount?.refreshToken) {
      throw new Error('Email account not found or refresh token missing');
    }

    console.log(`[BULK_EMAIL_FETCH] Setting up Gmail client for account ${accountId} (${emailAccount.emailAddress})`);
    console.log(`[BULK_EMAIL_FETCH] Account created: ${emailAccount.createdAt}`);
    console.log(`[BULK_EMAIL_FETCH] Refresh token length: ${emailAccount.refreshToken.length}`);

    const oauthClient = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'postmessage'
    );

    // Set the refresh token
    oauthClient.setCredentials({ refresh_token: emailAccount.refreshToken });

    // Add event listener for token refresh
    oauthClient.on('tokens', (tokens) => {
      console.log(`[BULK_EMAIL_FETCH] ✅ New tokens received for account ${accountId}`);
      if (tokens.access_token) {
        console.log(`[BULK_EMAIL_FETCH] New access token length: ${tokens.access_token.length}`);
      }
      // TODO: Save new tokens to database if needed
    });

    // Test the authentication by making a simple call
    try {
      const gmail = google.gmail({ version: 'v1', auth: oauthClient });
      
      // Test the connection with a simple profile call
      console.log(`[BULK_EMAIL_FETCH] Testing Gmail API connection for account ${accountId}...`);
      const profile = await gmail.users.getProfile({ userId: 'me' });
      console.log(`[BULK_EMAIL_FETCH] ✅ Gmail API connection successful for ${profile.data.emailAddress}`);
      
      return gmail;
    } catch (error: any) {
      console.error(`[BULK_EMAIL_FETCH] ❌ Gmail API authentication failed for account ${accountId}:`, error.message);
      console.error(`[BULK_EMAIL_FETCH] Error details:`, {
        code: error.code,
        status: error.status,
        message: error.message
      });
      
      if (error.message.includes('invalid_grant')) {
        throw new Error(`Gmail authentication failed: The refresh token for account ${emailAccount.emailAddress} is invalid or expired. Please reconnect your Google account.`);
      }
      
      throw error;
    }
  }

  private processEmailMessage(message: any, accountId: string): NewEmail {
    const headers = message.payload?.headers || [];
    const getHeader = (name: string) => headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value;

    // Extract email body
    const bodyData = this.extractEmailBody(message.payload);
    
    return {
      accountId,
      providerMessageId: message.id,
      threadId: message.threadId,
      subject: getHeader('Subject'),
      fromAddress: getHeader('From'),
      toAddresses: this.parseAddresses(getHeader('To')),
      ccAddresses: this.parseAddresses(getHeader('Cc')),
      bccAddresses: this.parseAddresses(getHeader('Bcc')),
      replyTo: getHeader('Reply-To'),
      bodyText: bodyData.text,
      bodyHtml: bodyData.html,
      snippet: message.snippet,
      receivedAt: new Date(getHeader('Date') || Date.now()),
      sentAt: new Date(getHeader('Date') || Date.now()),
      isRead: !message.labelIds?.includes('UNREAD'),
      isStarred: message.labelIds?.includes('STARRED') || false,
      isImportant: message.labelIds?.includes('IMPORTANT') || false,
      isSent: message.labelIds?.includes('SENT') || false,
      isDraft: message.labelIds?.includes('DRAFT') || false,
      sizeBytes: message.sizeEstimate,
      hasAttachments: this.hasAttachments(message.payload),
      processingStatus: 'pending'
    };
  }

  private extractEmailBody(payload: any): { text?: string; html?: string } {
    const findPart = (parts: any[], mimeType: string): string | null => {
      for (const part of parts) {
        if (part.mimeType === mimeType && part.body?.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
        if (part.parts) {
          const found = findPart(part.parts, mimeType);
          if (found) return found;
        }
      }
      return null;
    };

    if (payload?.parts) {
      return {
        html: findPart(payload.parts, 'text/html') || undefined,
        text: findPart(payload.parts, 'text/plain') || undefined
      };
    } else if (payload?.body?.data) {
      const content = Buffer.from(payload.body.data, 'base64').toString('utf-8');
      return { text: content };
    }

    return {};
  }

  private parseAddresses(addressString?: string): string[] {
    if (!addressString) return [];
    return addressString.split(',').map(addr => addr.trim()).filter(Boolean);
  }

  private hasAttachments(payload: any): boolean {
    const checkParts = (parts: any[]): boolean => {
      return parts.some(part => {
        if (part.filename && part.filename.length > 0) return true;
        if (part.parts) return checkParts(part.parts);
        return false;
      });
    };

    return payload?.parts ? checkParts(payload.parts) : false;
  }
} 