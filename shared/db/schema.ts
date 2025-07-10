import { 
  pgTable, 
  uuid, 
  varchar, 
  timestamp, 
  text, 
  boolean, 
  integer, 
  jsonb, 
  date,
  decimal,
  index
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ==========================================
// ENHANCED USER MANAGEMENT
// ==========================================

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  subscriptionTier: varchar('subscription_tier', { length: 50 }).default('free'),
  timezone: varchar('timezone', { length: 100 }).default('UTC'),
  language: varchar('language', { length: 10 }).default('en'),
  usageQuota: jsonb('usage_quota').default({
    monthly_ai_requests: 100,
    monthly_searches: 500,
    max_email_accounts: 1,
    max_integrations: 0
  }),
  preferences: jsonb('preferences').default({
    email_notifications: true,
    auto_draft_enabled: false,
    briefing_time: '09:00',
    priority_threshold: 70
  }),
  writingStyle: jsonb('writing_style').default({}),
  onboardingCompleted: boolean('onboarding_completed').default(false),
  lastActiveAt: timestamp('last_active_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ==========================================
// MULTI-PROVIDER EMAIL ACCOUNTS
// ==========================================

export const emailAccounts = pgTable('email_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 50 }).notNull(), // 'gmail', 'outlook', 'yahoo', 'imap'
  emailAddress: varchar('email_address', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  refreshToken: text('refresh_token'),
  accessToken: text('access_token'),
  tokenExpiresAt: timestamp('token_expires_at'),
  providerAccountId: varchar('provider_account_id', { length: 255 }),
  syncEnabled: boolean('sync_enabled').default(true),
  isPrimary: boolean('is_primary').default(false),
  onboardingCompleted: boolean('onboarding_completed').default(false),
  syncStatus: varchar('sync_status', { length: 50 }).default('active'),
  syncCursor: varchar('sync_cursor', { length: 255 }), // For incremental sync
  lastSyncAt: timestamp('last_sync_at'),
  totalEmailsSynced: integer('total_emails_synced').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    userEmailIdx: index('idx_email_accounts_user_email').on(table.userId, table.emailAddress),
  };
});

// ==========================================
// PERSISTENT EMAIL STORAGE
// ==========================================

export const emails = pgTable('emails', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => emailAccounts.id, { onDelete: 'cascade' }),
  providerMessageId: varchar('provider_message_id', { length: 255 }).notNull(),
  threadId: varchar('thread_id', { length: 255 }),
  subject: text('subject'),
  fromAddress: varchar('from_address', { length: 255 }),
  fromName: varchar('from_name', { length: 255 }),
  toAddresses: jsonb('to_addresses').default([]),
  ccAddresses: jsonb('cc_addresses').default([]),
  bccAddresses: jsonb('bcc_addresses').default([]),
  replyTo: varchar('reply_to', { length: 255 }),
  bodyText: text('body_text'),
  bodyHtml: text('body_html'),
  snippet: text('snippet'),
  receivedAt: timestamp('received_at'),
  sentAt: timestamp('sent_at'),
  isRead: boolean('is_read').default(false),
  isStarred: boolean('is_starred').default(false),
  isImportant: boolean('is_important').default(false),
  isSent: boolean('is_sent').default(false),
  isDraft: boolean('is_draft').default(false),
  priorityScore: integer('priority_score').default(0),
  sentimentScore: decimal('sentiment_score', { precision: 3, scale: 2 }),
  summary: text('summary'),
  extractedActions: jsonb('extracted_actions').default([]),
  extractedEntities: jsonb('extracted_entities').default({}),
  processingStatus: varchar('processing_status', { length: 50 }).default('pending'),
  sizeBytes: integer('size_bytes'),
  hasAttachments: boolean('has_attachments').default(false),
  folderName: varchar('folder_name', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    accountReceivedIdx: index('idx_emails_account_received').on(table.accountId, table.receivedAt),
    threadIdx: index('idx_emails_thread').on(table.threadId),
    priorityIdx: index('idx_emails_priority').on(table.priorityScore, table.receivedAt),
    processingStatusIdx: index('idx_emails_processing_status').on(table.processingStatus),
    uniqueAccountMessage: index('idx_emails_unique_account_message').on(table.accountId, table.providerMessageId),
  };
});

// ==========================================
// EMAIL ATTACHMENTS
// ==========================================

export const emailAttachments = pgTable('email_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  emailId: uuid('email_id').notNull().references(() => emails.id, { onDelete: 'cascade' }),
  filename: varchar('filename', { length: 255 }).notNull(),
  contentType: varchar('content_type', { length: 100 }),
  sizeBytes: integer('size_bytes'),
  providerAttachmentId: varchar('provider_attachment_id', { length: 255 }),
  contentText: text('content_text'), // Extracted text content
  isInline: boolean('is_inline').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ==========================================
// EMAIL EMBEDDINGS FOR SEMANTIC SEARCH
// ==========================================

export const emailEmbeddings = pgTable('email_embeddings', {
  id: uuid('id').primaryKey().defaultRandom(),
  emailId: uuid('email_id').notNull().references(() => emails.id, { onDelete: 'cascade' }),
  embeddingVector: text('embedding_vector').notNull(), // JSON array of floats
  embeddingModel: varchar('embedding_model', { length: 100 }).notNull(),
  contentHash: varchar('content_hash', { length: 64 }), // For deduplication
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => {
  return {
    emailModelIdx: index('idx_email_embeddings_email_model').on(table.emailId, table.embeddingModel),
  };
});

// ==========================================
// LABELS SYSTEM
// ==========================================

export const labels = pgTable('labels', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  color: varchar('color', { length: 7 }).default('#6366f1'), // hex color
  description: text('description'),
  type: varchar('type', { length: 50 }).default('custom'), // 'custom', 'auto', 'system'
  creationPrompt: text('creation_prompt'), // For AI-generated labels
  autoApplyRules: jsonb('auto_apply_rules').default({}),
  isActive: boolean('is_active').default(true),
  usageCount: integer('usage_count').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    userNameIdx: index('idx_labels_user_name').on(table.userId, table.name),
  };
});

// ==========================================
// EMAIL-LABEL RELATIONSHIPS
// ==========================================

export const emailLabels = pgTable('email_labels', {
  emailId: uuid('email_id').notNull().references(() => emails.id, { onDelete: 'cascade' }),
  labelId: uuid('label_id').notNull().references(() => labels.id, { onDelete: 'cascade' }),
  appliedBy: varchar('applied_by', { length: 50 }).default('user'), // 'user', 'auto', 'rule'
  confidenceScore: decimal('confidence_score', { precision: 3, scale: 2 }),
  appliedAt: timestamp('applied_at').defaultNow().notNull(),
}, (table) => {
  return {
    emailIdx: index('idx_email_labels_email').on(table.emailId),
    labelIdx: index('idx_email_labels_label').on(table.labelId),
  };
});

// ==========================================
// DRAFT EMAILS (24/7 GENERATION)
// ==========================================

export const draftEmails = pgTable('draft_emails', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => emailAccounts.id, { onDelete: 'cascade' }),
  originalEmailId: uuid('original_email_id').references(() => emails.id),
  draftType: varchar('draft_type', { length: 50 }).notNull(), // 'reply', 'forward', 'new'
  subject: text('subject'),
  toAddresses: jsonb('to_addresses').default([]),
  ccAddresses: jsonb('cc_addresses').default([]),
  bccAddresses: jsonb('bcc_addresses').default([]),
  bodyText: text('body_text'),
  bodyHtml: text('body_html'),
  generationPrompt: text('generation_prompt'),
  aiModelUsed: varchar('ai_model_used', { length: 100 }),
  confidenceScore: decimal('confidence_score', { precision: 3, scale: 2 }),
  userFeedback: jsonb('user_feedback').default({}),
  status: varchar('status', { length: 50 }).default('draft'), // 'draft', 'reviewed', 'sent', 'discarded'
  providerDraftId: varchar('provider_draft_id', { length: 255 }),
  generatedAt: timestamp('generated_at').defaultNow().notNull(),
  modifiedAt: timestamp('modified_at').defaultNow().notNull(),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ==========================================
// AUTOMATION RULES ENGINE
// ==========================================

export const automationRules = pgTable('automation_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  triggerType: varchar('trigger_type', { length: 100 }).notNull(),
  conditions: jsonb('conditions').notNull(),
  actions: jsonb('actions').notNull(),
  priority: integer('priority').default(0),
  isActive: boolean('is_active').default(true),
  executionCount: integer('execution_count').default(0),
  successCount: integer('success_count').default(0),
  lastExecutedAt: timestamp('last_executed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    userActiveIdx: index('idx_automation_rules_user_active').on(table.userId, table.isActive),
  };
});

// ==========================================
// RULE EXECUTION LOGS
// ==========================================

export const automationLogs = pgTable('automation_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ruleId: uuid('rule_id').notNull().references(() => automationRules.id, { onDelete: 'cascade' }),
  emailId: uuid('email_id').notNull().references(() => emails.id, { onDelete: 'cascade' }),
  executionStatus: varchar('execution_status', { length: 50 }).notNull(),
  executedActions: jsonb('executed_actions').default([]),
  errorMessage: text('error_message'),
  executionTimeMs: integer('execution_time_ms'),
  executedAt: timestamp('executed_at').defaultNow().notNull(),
}, (table) => {
  return {
    ruleExecutedIdx: index('idx_automation_logs_rule_executed').on(table.ruleId, table.executedAt),
  };
});

// ==========================================
// THIRD-PARTY INTEGRATIONS
// ==========================================

export const integrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 100 }).notNull(), // 'salesforce', 'hubspot', 'slack', etc.
  integrationType: varchar('integration_type', { length: 50 }).notNull(),
  configuration: jsonb('configuration').notNull(),
  credentials: jsonb('credentials').notNull(), // Encrypted
  webhookUrl: text('webhook_url'),
  isActive: boolean('is_active').default(true),
  syncFrequency: integer('sync_frequency').default(3600), // seconds
  lastSyncAt: timestamp('last_sync_at'),
  nextSyncAt: timestamp('next_sync_at'),
  errorCount: integer('error_count').default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    userActiveIdx: index('idx_integrations_user_active').on(table.userId, table.isActive),
  };
});

// ==========================================
// INTEGRATION SYNC LOGS
// ==========================================

export const integrationSyncLogs = pgTable('integration_sync_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  integrationId: uuid('integration_id').notNull().references(() => integrations.id, { onDelete: 'cascade' }),
  syncType: varchar('sync_type', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).notNull(),
  recordsProcessed: integer('records_processed').default(0),
  recordsCreated: integer('records_created').default(0),
  recordsUpdated: integer('records_updated').default(0),
  recordsFailed: integer('records_failed').default(0),
  errorDetails: jsonb('error_details').default({}),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  durationMs: integer('duration_ms'),
});

// ==========================================
// USAGE METRICS AND ANALYTICS
// ==========================================

export const usageMetrics = pgTable('usage_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  metricType: varchar('metric_type', { length: 100 }).notNull(),
  metricSubtype: varchar('metric_subtype', { length: 100 }),
  metricValue: integer('metric_value').notNull(),
  metadata: jsonb('metadata').default({}),
  periodStart: timestamp('period_start').notNull(),
  periodEnd: timestamp('period_end').notNull(),
  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
}, (table) => {
  return {
    userMetricPeriodIdx: index('idx_usage_metrics_user_type_period').on(table.userId, table.metricType, table.periodStart),
  };
});

// ==========================================
// DAILY BRIEFINGS
// ==========================================

export const dailyBriefings = pgTable('daily_briefings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  briefingDate: date('briefing_date').notNull(),
  briefingType: varchar('briefing_type', { length: 50 }).default('daily'),
  content: jsonb('content').notNull(),
  priorityEmails: jsonb('priority_emails').default([]), // Array of email IDs
  actionItems: jsonb('action_items').default([]),
  statistics: jsonb('statistics').default({}),
  deliveryStatus: varchar('delivery_status', { length: 50 }).default('pending'),
  deliveredAt: timestamp('delivered_at'),
  generatedAt: timestamp('generated_at').defaultNow().notNull(),
}, (table) => {
  return {
    userDateTypeIdx: index('idx_daily_briefings_user_date_type').on(table.userId, table.briefingDate, table.briefingType),
  };
});

// ==========================================
// MEETING AND CALENDAR INTEGRATION
// ==========================================

export const meetings = pgTable('meetings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  organizerEmail: varchar('organizer_email', { length: 255 }),
  title: varchar('title', { length: 500 }),
  description: text('description'),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  timezone: varchar('timezone', { length: 100 }),
  location: text('location'),
  attendees: jsonb('attendees').default([]),
  meetingUrl: text('meeting_url'),
  providerEventId: varchar('provider_event_id', { length: 255 }),
  provider: varchar('provider', { length: 50 }),
  status: varchar('status', { length: 50 }).default('scheduled'),
  aiGenerated: boolean('ai_generated').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    userTimeIdx: index('idx_meetings_user_time').on(table.userId, table.startTime),
  };
});

// ==========================================
// RELATIONSHIPS
// ==========================================

export const usersRelations = relations(users, ({ many }) => ({
  emailAccounts: many(emailAccounts),
  labels: many(labels),
  automationRules: many(automationRules),
  integrations: many(integrations),
  usageMetrics: many(usageMetrics),
  dailyBriefings: many(dailyBriefings),
  meetings: many(meetings),
}));

export const emailAccountsRelations = relations(emailAccounts, ({ one, many }) => ({
  user: one(users, {
    fields: [emailAccounts.userId],
    references: [users.id],
  }),
  emails: many(emails),
  draftEmails: many(draftEmails),
}));

export const emailsRelations = relations(emails, ({ one, many }) => ({
  account: one(emailAccounts, {
    fields: [emails.accountId],
    references: [emailAccounts.id],
  }),
  attachments: many(emailAttachments),
  embeddings: many(emailEmbeddings),
  labels: many(emailLabels),
  drafts: many(draftEmails),
  automationLogs: many(automationLogs),
}));

export const emailAttachmentsRelations = relations(emailAttachments, ({ one }) => ({
  email: one(emails, {
    fields: [emailAttachments.emailId],
    references: [emails.id],
  }),
}));

export const emailEmbeddingsRelations = relations(emailEmbeddings, ({ one }) => ({
  email: one(emails, {
    fields: [emailEmbeddings.emailId],
    references: [emails.id],
  }),
}));

export const labelsRelations = relations(labels, ({ one, many }) => ({
  user: one(users, {
    fields: [labels.userId],
    references: [users.id],
  }),
  emails: many(emailLabels),
}));

export const emailLabelsRelations = relations(emailLabels, ({ one }) => ({
  email: one(emails, {
    fields: [emailLabels.emailId],
    references: [emails.id],
  }),
  label: one(labels, {
    fields: [emailLabels.labelId],
    references: [labels.id],
  }),
}));

export const draftEmailsRelations = relations(draftEmails, ({ one }) => ({
  account: one(emailAccounts, {
    fields: [draftEmails.accountId],
    references: [emailAccounts.id],
  }),
  originalEmail: one(emails, {
    fields: [draftEmails.originalEmailId],
    references: [emails.id],
  }),
}));

export const automationRulesRelations = relations(automationRules, ({ one, many }) => ({
  user: one(users, {
    fields: [automationRules.userId],
    references: [users.id],
  }),
  logs: many(automationLogs),
}));

export const automationLogsRelations = relations(automationLogs, ({ one }) => ({
  rule: one(automationRules, {
    fields: [automationLogs.ruleId],
    references: [automationRules.id],
  }),
  email: one(emails, {
    fields: [automationLogs.emailId],
    references: [emails.id],
  }),
}));

export const integrationsRelations = relations(integrations, ({ one, many }) => ({
  user: one(users, {
    fields: [integrations.userId],
    references: [users.id],
  }),
  syncLogs: many(integrationSyncLogs),
}));

export const integrationSyncLogsRelations = relations(integrationSyncLogs, ({ one }) => ({
  integration: one(integrations, {
    fields: [integrationSyncLogs.integrationId],
    references: [integrations.id],
  }),
}));

export const usageMetricsRelations = relations(usageMetrics, ({ one }) => ({
  user: one(users, {
    fields: [usageMetrics.userId],
    references: [users.id],
  }),
}));

export const dailyBriefingsRelations = relations(dailyBriefings, ({ one }) => ({
  user: one(users, {
    fields: [dailyBriefings.userId],
    references: [users.id],
  }),
}));

export const meetingsRelations = relations(meetings, ({ one }) => ({
  user: one(users, {
    fields: [meetings.userId],
    references: [users.id],
  }),
}));

// ==========================================
// TYPE EXPORTS
// ==========================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type EmailAccount = typeof emailAccounts.$inferSelect;
export type NewEmailAccount = typeof emailAccounts.$inferInsert;
export type Email = typeof emails.$inferSelect;
export type NewEmail = typeof emails.$inferInsert;
export type EmailAttachment = typeof emailAttachments.$inferSelect;
export type NewEmailAttachment = typeof emailAttachments.$inferInsert;
export type EmailEmbedding = typeof emailEmbeddings.$inferSelect;
export type NewEmailEmbedding = typeof emailEmbeddings.$inferInsert;
export type Label = typeof labels.$inferSelect;
export type NewLabel = typeof labels.$inferInsert;
export type EmailLabel = typeof emailLabels.$inferSelect;
export type NewEmailLabel = typeof emailLabels.$inferInsert;
export type DraftEmail = typeof draftEmails.$inferSelect;
export type NewDraftEmail = typeof draftEmails.$inferInsert;
export type AutomationRule = typeof automationRules.$inferSelect;
export type NewAutomationRule = typeof automationRules.$inferInsert;
export type AutomationLog = typeof automationLogs.$inferSelect;
export type NewAutomationLog = typeof automationLogs.$inferInsert;
export type Integration = typeof integrations.$inferSelect;
export type NewIntegration = typeof integrations.$inferInsert;
export type IntegrationSyncLog = typeof integrationSyncLogs.$inferSelect;
export type NewIntegrationSyncLog = typeof integrationSyncLogs.$inferInsert;
export type UsageMetric = typeof usageMetrics.$inferSelect;
export type NewUsageMetric = typeof usageMetrics.$inferInsert;
export type DailyBriefing = typeof dailyBriefings.$inferSelect;
export type NewDailyBriefing = typeof dailyBriefings.$inferInsert;
export type Meeting = typeof meetings.$inferSelect;
export type NewMeeting = typeof meetings.$inferInsert;

// ==========================================
// TABLE EXPORTS FOR EASY IMPORTING
// ==========================================

export const tables = {
  users,
  emailAccounts,
  emails,
  emailAttachments,
  emailEmbeddings,
  labels,
  emailLabels,
  draftEmails,
  automationRules,
  automationLogs,
  integrations,
  integrationSyncLogs,
  usageMetrics,
  dailyBriefings,
  meetings,
};

// ==========================================
// LEGACY COMPATIBILITY
// ==========================================

// Keep backward compatibility with existing code
export const userEmailAccounts = emailAccounts;
export type UserEmailAccount = EmailAccount;
export type NewUserEmailAccount = NewEmailAccount; 