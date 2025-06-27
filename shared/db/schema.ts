import { pgTable, uuid, varchar, timestamp, text } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ==========================================
// CORE TABLES
// ==========================================

// Core user table - managed by User Management Service
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Email accounts table - managed by Email Sync Service
export const userEmailAccounts = pgTable('user_email_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 50 }).notNull().default('gmail'), // 'gmail', 'outlook', etc.
  providerAccountId: varchar('provider_account_id', { length: 255 }), // Google account ID
  refreshToken: text('refresh_token'), // Long-lived refresh token for Gmail API
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ==========================================
// RELATIONSHIPS
// ==========================================

export const usersRelations = relations(users, ({ many }) => ({
  emailAccounts: many(userEmailAccounts),
}));

export const userEmailAccountsRelations = relations(userEmailAccounts, ({ one }) => ({
  user: one(users, {
    fields: [userEmailAccounts.userId],
    references: [users.id],
  }),
}));

// ==========================================
// TYPE EXPORTS
// ==========================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserEmailAccount = typeof userEmailAccounts.$inferSelect;
export type NewUserEmailAccount = typeof userEmailAccounts.$inferInsert;

// ==========================================
// TABLE EXPORTS FOR EASY IMPORTING
// ==========================================

export const tables = {
  users,
  userEmailAccounts,
};

export const schemaRelations = {
  usersRelations,
  userEmailAccountsRelations,
}; 