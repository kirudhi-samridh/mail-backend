CREATE TABLE "automation_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"email_id" uuid NOT NULL,
	"execution_status" varchar(50) NOT NULL,
	"executed_actions" jsonb DEFAULT '[]'::jsonb,
	"error_message" text,
	"execution_time_ms" integer,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"trigger_type" varchar(100) NOT NULL,
	"conditions" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"priority" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"execution_count" integer DEFAULT 0,
	"success_count" integer DEFAULT 0,
	"last_executed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_briefings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"briefing_date" date NOT NULL,
	"briefing_type" varchar(50) DEFAULT 'daily',
	"content" jsonb NOT NULL,
	"priority_emails" jsonb DEFAULT '[]'::jsonb,
	"action_items" jsonb DEFAULT '[]'::jsonb,
	"statistics" jsonb DEFAULT '{}'::jsonb,
	"delivery_status" varchar(50) DEFAULT 'pending',
	"delivered_at" timestamp,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"original_email_id" uuid,
	"draft_type" varchar(50) NOT NULL,
	"subject" text,
	"to_addresses" jsonb DEFAULT '[]'::jsonb,
	"cc_addresses" jsonb DEFAULT '[]'::jsonb,
	"bcc_addresses" jsonb DEFAULT '[]'::jsonb,
	"body_text" text,
	"body_html" text,
	"generation_prompt" text,
	"ai_model_used" varchar(100),
	"confidence_score" numeric(3, 2),
	"user_feedback" jsonb DEFAULT '{}'::jsonb,
	"status" varchar(50) DEFAULT 'draft',
	"provider_draft_id" varchar(255),
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"modified_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(50) NOT NULL,
	"email_address" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"refresh_token" text,
	"access_token" text,
	"token_expires_at" timestamp,
	"provider_account_id" varchar(255),
	"sync_enabled" boolean DEFAULT true,
	"is_primary" boolean DEFAULT false,
	"sync_status" varchar(50) DEFAULT 'active',
	"sync_cursor" varchar(255),
	"last_sync_at" timestamp,
	"total_emails_synced" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_id" uuid NOT NULL,
	"filename" varchar(255) NOT NULL,
	"content_type" varchar(100),
	"size_bytes" integer,
	"provider_attachment_id" varchar(255),
	"content_text" text,
	"is_inline" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_id" uuid NOT NULL,
	"embedding_vector" text NOT NULL,
	"embedding_model" varchar(100) NOT NULL,
	"content_hash" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_labels" (
	"email_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"applied_by" varchar(50) DEFAULT 'user',
	"confidence_score" numeric(3, 2),
	"applied_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"provider_message_id" varchar(255) NOT NULL,
	"thread_id" varchar(255),
	"subject" text,
	"from_address" varchar(255),
	"from_name" varchar(255),
	"to_addresses" jsonb DEFAULT '[]'::jsonb,
	"cc_addresses" jsonb DEFAULT '[]'::jsonb,
	"bcc_addresses" jsonb DEFAULT '[]'::jsonb,
	"reply_to" varchar(255),
	"body_text" text,
	"body_html" text,
	"snippet" text,
	"received_at" timestamp,
	"sent_at" timestamp,
	"is_read" boolean DEFAULT false,
	"is_starred" boolean DEFAULT false,
	"is_important" boolean DEFAULT false,
	"is_sent" boolean DEFAULT false,
	"is_draft" boolean DEFAULT false,
	"priority_score" integer DEFAULT 0,
	"sentiment_score" numeric(3, 2),
	"summary" text,
	"extracted_actions" jsonb DEFAULT '[]'::jsonb,
	"extracted_entities" jsonb DEFAULT '{}'::jsonb,
	"processing_status" varchar(50) DEFAULT 'pending',
	"size_bytes" integer,
	"has_attachments" boolean DEFAULT false,
	"folder_name" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"sync_type" varchar(50) NOT NULL,
	"status" varchar(50) NOT NULL,
	"records_processed" integer DEFAULT 0,
	"records_created" integer DEFAULT 0,
	"records_updated" integer DEFAULT 0,
	"records_failed" integer DEFAULT 0,
	"error_details" jsonb DEFAULT '{}'::jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(100) NOT NULL,
	"integration_type" varchar(50) NOT NULL,
	"configuration" jsonb NOT NULL,
	"credentials" jsonb NOT NULL,
	"webhook_url" text,
	"is_active" boolean DEFAULT true,
	"sync_frequency" integer DEFAULT 3600,
	"last_sync_at" timestamp,
	"next_sync_at" timestamp,
	"error_count" integer DEFAULT 0,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"color" varchar(7) DEFAULT '#6366f1',
	"description" text,
	"type" varchar(50) DEFAULT 'custom',
	"creation_prompt" text,
	"auto_apply_rules" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true,
	"usage_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organizer_email" varchar(255),
	"title" varchar(500),
	"description" text,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"timezone" varchar(100),
	"location" text,
	"attendees" jsonb DEFAULT '[]'::jsonb,
	"meeting_url" text,
	"provider_event_id" varchar(255),
	"provider" varchar(50),
	"status" varchar(50) DEFAULT 'scheduled',
	"ai_generated" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"metric_type" varchar(100) NOT NULL,
	"metric_subtype" varchar(100),
	"metric_value" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"subscription_tier" varchar(50) DEFAULT 'free',
	"timezone" varchar(100) DEFAULT 'UTC',
	"language" varchar(10) DEFAULT 'en',
	"usage_quota" jsonb DEFAULT '{"monthly_ai_requests":100,"monthly_searches":500,"max_email_accounts":1,"max_integrations":0}'::jsonb,
	"preferences" jsonb DEFAULT '{"email_notifications":true,"auto_draft_enabled":false,"briefing_time":"09:00","priority_threshold":70}'::jsonb,
	"writing_style" jsonb DEFAULT '{}'::jsonb,
	"onboarding_completed" boolean DEFAULT false,
	"last_active_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_briefings" ADD CONSTRAINT "daily_briefings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_emails" ADD CONSTRAINT "draft_emails_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_emails" ADD CONSTRAINT "draft_emails_original_email_id_emails_id_fk" FOREIGN KEY ("original_email_id") REFERENCES "public"."emails"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_embeddings" ADD CONSTRAINT "email_embeddings_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_labels" ADD CONSTRAINT "email_labels_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_labels" ADD CONSTRAINT "email_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_logs" ADD CONSTRAINT "integration_sync_logs_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_metrics" ADD CONSTRAINT "usage_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_automation_logs_rule_executed" ON "automation_logs" USING btree ("rule_id","executed_at");--> statement-breakpoint
CREATE INDEX "idx_automation_rules_user_active" ON "automation_rules" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_daily_briefings_user_date_type" ON "daily_briefings" USING btree ("user_id","briefing_date","briefing_type");--> statement-breakpoint
CREATE INDEX "idx_email_accounts_user_email" ON "email_accounts" USING btree ("user_id","email_address");--> statement-breakpoint
CREATE INDEX "idx_email_embeddings_email_model" ON "email_embeddings" USING btree ("email_id","embedding_model");--> statement-breakpoint
CREATE INDEX "idx_email_labels_email" ON "email_labels" USING btree ("email_id");--> statement-breakpoint
CREATE INDEX "idx_email_labels_label" ON "email_labels" USING btree ("label_id");--> statement-breakpoint
CREATE INDEX "idx_emails_account_received" ON "emails" USING btree ("account_id","received_at");--> statement-breakpoint
CREATE INDEX "idx_emails_thread" ON "emails" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_emails_priority" ON "emails" USING btree ("priority_score","received_at");--> statement-breakpoint
CREATE INDEX "idx_emails_processing_status" ON "emails" USING btree ("processing_status");--> statement-breakpoint
CREATE INDEX "idx_emails_unique_account_message" ON "emails" USING btree ("account_id","provider_message_id");--> statement-breakpoint
CREATE INDEX "idx_integrations_user_active" ON "integrations" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_labels_user_name" ON "labels" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "idx_meetings_user_time" ON "meetings" USING btree ("user_id","start_time");--> statement-breakpoint
CREATE INDEX "idx_usage_metrics_user_type_period" ON "usage_metrics" USING btree ("user_id","metric_type","period_start");