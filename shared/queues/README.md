# Universal Queue System

## Overview
A powerful, reusable queue management system built on BullMQ that can handle any type of background processing across the LMAA platform.

## Architecture

```
shared/queues/
├── README.md                    # This file - documentation
├── index.ts                     # Main exports
├── core/
│   ├── UniversalQueue.ts        # Main universal queue interface
│   ├── QueueFactory.ts          # Factory for creating typed queues
│   ├── JobProcessor.ts          # Generic job processing framework
│   └── QueueRegistry.ts         # Central queue registry
├── types/
│   ├── interfaces.ts            # Core interfaces and types
│   ├── job-types.ts            # Predefined job type definitions
│   └── queue-configs.ts        # Queue configuration schemas
├── processors/
│   ├── BaseProcessor.ts         # Abstract base processor
│   ├── RetryProcessor.ts        # Retry logic processor
│   └── BatchProcessor.ts        # Batch job processor
├── monitoring/
│   ├── QueueMonitor.ts          # Queue health and metrics
│   ├── JobTracker.ts           # Individual job tracking
│   └── PerformanceAnalyzer.ts  # Performance optimization
├── utils/
│   ├── priority-calculator.ts   # Smart priority assignment
│   ├── delay-calculator.ts     # Intelligent delay strategies
│   └── queue-utils.ts          # Utility functions
├── middleware/
│   ├── logging.ts              # Queue operation logging
│   ├── rate-limiting.ts        # Rate limiting middleware
│   └── error-handling.ts       # Error handling middleware
└── legacy/
    └── queue-manager.ts         # Existing implementation (preserved)

## Usage

```typescript
import { UniversalQueue, QueueFactory } from '@shared/queues';

// Create a typed queue
const emailQueue = QueueFactory.create('email-processing', {
  concurrency: 5,
  retryAttempts: 3,
  priority: 'high'
});

// Add jobs
await emailQueue.addJob('process-email', { emailId: '123' });
```

## Key Features

- **Type-Safe**: Full TypeScript support with generic types
- **Reusable**: Works for any job type across all services
- **Monitoring**: Built-in metrics and health monitoring
- **Recovery**: Intelligent retry and error handling
- **Performance**: Optimized for high throughput
- **Extensible**: Plugin architecture for custom behaviors 