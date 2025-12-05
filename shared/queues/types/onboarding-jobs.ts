import { BaseJobData } from './job-types';

export interface OnboardingJobData extends BaseJobData {
  accountId: string;
  fetchDays: number;
  summaryDays: number;
  emailAddress: string;
  userToken?: string; // JWT token for downstream service authentication
  metadata: {
    correlationId: string;
    startedAt: Date;
    totalEstimatedEmails?: number;
  };
}

export interface BulkEmailFetchJobData extends BaseJobData {
  accountId: string;
  batchSize: number;
  pageToken?: string;
  fetchDays: number;
  summaryDays: number;
  userToken?: string; // JWT token for downstream service authentication
  metadata: {
    correlationId: string;
    batchNumber: number;
    totalBatches?: number;
  };
}

export interface AISummaryJobData extends BaseJobData {
  emailId: string;
  userToken?: string; // JWT token for downstream service authentication
  metadata: {
    correlationId: string;
  };
}

export interface FinalizeOnboardingJobData extends BaseJobData {
  accountId: string;
  metadata: {
    correlationId: string;
    totalEmailsFetched: number;
    totalSummariesGenerated: number;
    completedAt: Date;
  };
}

export interface OnboardingErrorContext {
  correlationId: string;
  userId: string;
  accountId: string;
  stage: 'fetch' | 'summary' | 'finalize';
  emailAddress: string;
  attemptNumber: number;
}

export type OnboardingJobTypes = 
  | OnboardingJobData
  | BulkEmailFetchJobData
  | AISummaryJobData
  | FinalizeOnboardingJobData; 