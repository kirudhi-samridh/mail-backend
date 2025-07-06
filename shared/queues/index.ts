/**
 * Universal Queue System - Main Exports
 * 
 * This file serves as the main entry point for the Universal Queue System.
 * It exports all the core components, interfaces, and utilities that can be
 * used across the LMAA platform for any type of background job processing.
 */

// =============================================
// Core Components (Phase 1 - IMPLEMENTED ✅)
// =============================================
export { UniversalQueue } from './core/UniversalQueue';
export { QueueFactory, queueFactory, getQueueFactory, createQueue, getQueue } from './core/QueueFactory';
export { 
  JobProcessor,
  createSimpleProcessor,
  createEnhancedProcessor,
  loggingMiddleware,
  timingMiddleware,
  errorHandlingMiddleware,
  progressTrackingMiddleware
} from './core/JobProcessor';
export { 
  QueueRegistry, 
  queueRegistry, 
  getQueueRegistry,
  type SystemHealth,
  type QueueHealthDetail,
  type RegistryEvent
} from './core/QueueRegistry';

// Dead Letter Queue Components (Phase 1 - IMPLEMENTED ✅)
export { DeadLetterQueue } from './core/DeadLetterQueue';
export { 
  DLQManager,
  type SystemDLQStats,
  type DLQOperationOptions,
  type DLQHealthCheck
} from './core/DLQManager';

// =============================================
// Types and Interfaces (Phase 1 - IMPLEMENTED ✅)
// =============================================
export * from './types/interfaces';
export * from './types/job-types';
export * from './types/queue-configs';

// =============================================
// Processors (Phase 2 - IMPLEMENTED ✅)
// =============================================
export { OnboardingProcessor } from './processors/OnboardingProcessor';
export { BulkEmailFetchProcessor } from './processors/BulkEmailFetchProcessor';
export { AISummaryProcessor } from './processors/AISummaryProcessor';
export { FinalizeOnboardingProcessor } from './processors/FinalizeOnboardingProcessor';

// =============================================
// Monitoring (Phase 4 - NOT YET IMPLEMENTED ❌)
// =============================================
// TODO: Implement these components in Phase 4
// export { QueueMonitor } from './monitoring/QueueMonitor';
// export { JobTracker } from './monitoring/JobTracker';
// export { PerformanceAnalyzer } from './monitoring/PerformanceAnalyzer';

// =============================================
// Utilities (Phase 3 - NOT YET IMPLEMENTED ❌)
// =============================================
// TODO: Implement these components in Phase 3
// export * from './utils/priority-calculator';
// export * from './utils/delay-calculator';
// export * from './utils/queue-utils';

// =============================================
// Middleware (Phase 4 - NOT YET IMPLEMENTED ❌)
// =============================================
// TODO: Implement these components in Phase 4
// export { loggingMiddleware } from './middleware/logging';
// export { rateLimitingMiddleware } from './middleware/rate-limiting';
// export { errorHandlingMiddleware } from './middleware/error-handling';

// =============================================
// Legacy (Preserved for Backward Compatibility)
// =============================================
// Note: This will need to be moved/preserved when we implement the legacy folder
// export { QueueManager } from './legacy/queue-manager'; 