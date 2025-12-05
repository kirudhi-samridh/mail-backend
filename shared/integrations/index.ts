/**
 * External Integrations - Main Exports
 * 
 * This file serves as the main entry point for all external API integrations
 * in the LMAA platform. It exports API clients, authentication handlers,
 * and integration utilities.
 */

// =============================================
// Core API Framework (Phase 1 - IMPLEMENTED ✅)
// =============================================
export { 
  APIFramework, 
  apiFramework,
  APIClient,
  type APIConfig,
  type AuthStrategy,
  type OAuth2Credentials,
  type APIKeyCredentials,
  type BearerCredentials,
  type BasicCredentials,
  type RateLimit,
  type RetryPolicy,
  type DataTransformer,
  type APIRequest,
  type APIResponse,
  type BatchAPIRequest,
  type BatchAPIResponse,
  type APIMetrics
} from './APIFramework';

// =============================================
// Email Provider Clients (Phase 2 - NOT YET IMPLEMENTED ❌)
// =============================================
// TODO: Implement these components in Phase 2
// export { GmailClient } from './email/GmailClient';
// export { OutlookClient } from './email/OutlookClient';
// export { EmailSyncManager } from './email/EmailSyncManager';

// =============================================
 // Concurrency & Rate Limiting (Phase 2 - NOT YET IMPLEMENTED ❌)
// =============================================
// TODO: Implement these components in Phase 2
// export { ConcurrencyManager } from './ConcurrencyManager';
// export { RateLimitManager } from './RateLimitManager';
// export { CircuitBreaker } from './CircuitBreaker';

// =============================================
// AI Service Integrations (Phase 3 - NOT YET IMPLEMENTED ❌)
// =============================================
// TODO: Implement these components in Phase 3
// export { OpenAIClient } from './ai/OpenAIClient';
// export { GeminiClient } from './ai/GeminiClient';
// export { EmbeddingService } from './ai/EmbeddingService';

// =============================================
// Third-party Integrations (Phase 4 - NOT YET IMPLEMENTED ❌)
// =============================================
// TODO: Implement these components in Phase 4
// export { SlackClient } from './productivity/SlackClient';
// export { NotionClient } from './productivity/NotionClient';
// export { LinearClient } from './productivity/LinearClient'; 