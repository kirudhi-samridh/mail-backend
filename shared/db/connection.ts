import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as schema from './schema';

// Load environment variables from the root .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Database connection string
const connectionString = process.env.DATABASE_URL || 'postgresql://username:password@localhost:5432/lmaa';

// Create postgres client
const client = postgres(connectionString, {
  max: parseInt(process.env.DB_POOL_SIZE || '20'),
  idle_timeout: parseInt(process.env.DB_IDLE_TIMEOUT || '30'),
  connect_timeout: parseInt(process.env.DB_CONNECT_TIMEOUT || '10'),
  transform: {
    undefined: null
  }
});

// Create drizzle instance with all schemas
const db = drizzle(client, { 
  schema,
  logger: process.env.NODE_ENV === 'development'
});

// Export database instance
export function getDb() {
  return db;
}

// Export all tables for easy import (only the ones that actually exist)
export const {
  // User Management
  users,
  
  // Email Accounts
  emailAccounts,
  
  // Email Storage
  emails,
  emailAttachments,
  emailEmbeddings,
  
  // Labels and Organization
  labels,
  emailLabels,
  
  // Drafts
  draftEmails,
  
  // Automation
  automationRules,
  automationLogs,
  
  // Integrations
  integrations,
  integrationSyncLogs,
  
  // Usage Tracking
  usageMetrics,
  
  // Briefings
  dailyBriefings,
  
  // Meetings
  meetings
} = schema;

// Export all relations for use in queries (only the ones that actually exist)
export const {
  // User relations
  usersRelations,
  
  // Email relations
  emailAccountsRelations,
  emailsRelations,
  emailAttachmentsRelations,
  emailEmbeddingsRelations,
  
  // Label relations
  labelsRelations,
  emailLabelsRelations,
  
  // Draft relations
  draftEmailsRelations,
  
  // Automation relations
  automationRulesRelations,
  automationLogsRelations,
  
  // Integration relations
  integrationsRelations,
  integrationSyncLogsRelations,
  
  // Usage relations
  usageMetricsRelations,
  
  // Briefing relations
  dailyBriefingsRelations,
  
  // Meeting relations
  meetingsRelations
} = schema;

// Export all types for TypeScript support (only the ones that actually exist)
export type {
  // User types
  User,
  NewUser,
  
  // Email types
  EmailAccount,
  NewEmailAccount,
  Email,
  NewEmail,
  EmailAttachment,
  NewEmailAttachment,
  EmailEmbedding,
  NewEmailEmbedding,
  
  // Label types
  Label,
  NewLabel,
  EmailLabel,
  NewEmailLabel,
  
  // Draft types
  DraftEmail,
  NewDraftEmail,
  
  // Automation types
  AutomationRule,
  NewAutomationRule,
  AutomationLog,
  NewAutomationLog,
  
  // Integration types
  Integration,
  NewIntegration,
  IntegrationSyncLog,
  NewIntegrationSyncLog,
  
  // Usage types
  UsageMetric,
  NewUsageMetric,
  
  // Briefing types
  DailyBriefing,
  NewDailyBriefing,
  
  // Meeting types
  Meeting,
  NewMeeting
} from './schema';

// Database utility functions
export class DatabaseService {
  private db = getDb();

  // Transaction helper with proper typing
  async transaction<T>(
    callback: (tx: any) => Promise<T>
  ): Promise<T> {
    return this.db.transaction(callback);
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      await this.db.select().from(users).limit(1);
      return true;
    } catch {
      return false;
    }
  }

  // Get database statistics
  async getStats(): Promise<Record<string, number>> {
    try {
      const [userCount, emailCount, accountCount] = await Promise.all([
        this.db.select().from(users).then(r => r.length),
        this.db.select().from(emails).then(r => r.length),
        this.db.select().from(emailAccounts).then(r => r.length)
      ]);

      return {
        users: userCount,
        emails: emailCount,
        accounts: accountCount
      };
    } catch {
      return {};
    }
  }
}

// Export database service instance
export const dbService = new DatabaseService();

// Cleanup function
export async function closeDatabaseConnection(): Promise<void> {
  await client.end();
} 