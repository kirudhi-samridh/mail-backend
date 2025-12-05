# Dead Letter Queue (DLQ) Implementation Guide

## Overview

The Dead Letter Queue (DLQ) system provides enterprise-grade handling of failed jobs across the Universal Queue System. It automatically captures jobs that fail after exhausting all retry attempts, provides intelligent analysis and categorization, and offers comprehensive management capabilities.

## Key Features

### 🔄 **Automatic Job Capture**
- Jobs automatically move to DLQ after exhausting max retries
- Comprehensive failure context and metadata preservation
- Intelligent error categorization and analysis

### 🧠 **Intelligent Analysis**
- Automatic error categorization (network, timeout, validation, etc.)
- Retryability assessment based on error patterns
- Detailed job failure analysis with recommendations

### 📊 **Comprehensive Monitoring**
- System-wide DLQ statistics and health monitoring
- Per-queue DLQ metrics and trends
- Configurable alerting thresholds

### 🔧 **Management Operations**
- Individual and bulk job requeue operations
- Automated cleanup with configurable retention
- Auto-requeue with exponential backoff

### 🏥 **Health Monitoring**
- Regular health checks across all DLQs
- System health assessment and recommendations
- Proactive issue detection and alerting

## Architecture

```
┌─────────────────┐    ┌───────────────────┐    ┌──────────────────┐
│   UniversalQueue │    │   DeadLetterQueue │    │    DLQManager    │
│                 │    │                   │    │                  │
│ ┌─────────────┐ │    │ ┌───────────────┐ │    │ ┌──────────────┐ │
│ │ Job Fails   │ │───▶│ │  Store Job    │ │    │ │ System-wide  │ │
│ │ Max Retries │ │    │ │  Analyze      │ │    │ │ Monitoring   │ │
│ └─────────────┘ │    │ │  Categorize   │ │    │ │ Management   │ │
│                 │    │ └───────────────┘ │    │ └──────────────┘ │
│ ┌─────────────┐ │    │ ┌───────────────┐ │    │ ┌──────────────┐ │
│ │ Requeue     │ │◀───│ │  Requeue      │ │    │ │ Health       │ │
│ │ Job         │ │    │ │  Operations   │ │    │ │ Checks       │ │
│ └─────────────┘ │    │ └───────────────┘ │    │ └──────────────┘ │
└─────────────────┘    └───────────────────┘    └──────────────────┘
```

## Implementation

### 1. Basic DLQ Configuration

```typescript
import { QueueFactory } from './queues/core';

// Create queue with DLQ enabled
const emailQueue = QueueFactory.createQueue('email-processing', 'email-processing', {
  dlq: {
    enabled: true,
    maxRetries: 3,
    retentionDays: 7,
    maxSize: 1000,
    autoRequeue: {
      enabled: true,
      attempts: 2,
      backoffMultiplier: 2,
      maxBackoffMs: 300000
    },
    notification: {
      enabled: true,
      thresholds: {
        count: 50,
        timeWindowMs: 3600000
      }
    }
  }
});
```

### 2. DLQ Manager Setup

```typescript
import { DLQManager } from './queues/core';

// Create DLQ Manager
const dlqManager = new DLQManager({
  healthCheckIntervalMs: 5 * 60 * 1000, // 5 minutes
  maintenanceIntervalMs: 60 * 60 * 1000, // 1 hour
  autoCleanupEnabled: true,
  autoCleanupRetentionDays: 30,
  globalNotificationThresholds: {
    totalJobs: 1000,
    errorRate: 0.1,
    oldestJobDays: 14
  }
});

// Register queues
dlqManager.registerQueue(emailQueue);
dlqManager.registerQueue(aiQueue);
```

### 3. Monitoring DLQ Health

```typescript
// Get system-wide statistics
const systemStats = await dlqManager.getSystemStats();
console.log('System DLQ Stats:', {
  totalJobs: systemStats.totalDLQJobs,
  systemHealth: systemStats.systemHealth,
  jobsByCategory: systemStats.totalJobsByCategory
});

// Perform health checks
const healthChecks = await dlqManager.performHealthCheck();
healthChecks.forEach(check => {
  console.log(`Queue: ${check.queueName}, Status: ${check.status}`);
  if (check.issues.length > 0) {
    console.log('Issues:', check.issues);
    console.log('Recommendations:', check.recommendations);
  }
});
```

### 4. Job Analysis and Management

```typescript
// Search for failed jobs
const searchResult = await dlqManager.searchJobs({
  errorCategory: 'network',
  limit: 10,
  sortBy: 'movedToDLQAt',
  sortOrder: 'desc'
});

// Analyze individual jobs
for (const job of searchResult.jobs) {
  const analysis = await dlqManager.analyzeJob(job.queueName, job.dlqId);
  console.log(`Job ${job.dlqId}:`, {
    category: analysis.errorCategory,
    retryable: analysis.isRetryable,
    recommendation: analysis.recommendedAction,
    causes: analysis.possibleCauses,
    fixes: analysis.suggestedFixes
  });
}
```

### 5. Requeue Operations

```typescript
// Single job requeue
const success = await emailQueue.requeueFromDLQ('dlq_123456');

// Bulk requeue by category
const result = await dlqManager.bulkRequeue([
  {
    queueName: 'email-processing',
    dlqIds: ['dlq_123456', 'dlq_789012']
  }
]);

// Requeue by error category
const categoryResult = await emailQueue.getDLQ()?.requeueByCategory('network');
```

### 6. Cleanup Operations

```typescript
// Cleanup old jobs (dry run first)
const dryRunResult = await dlqManager.bulkCleanup(
  new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
  { dryRun: true }
);

// Actual cleanup
if (dryRunResult.success) {
  const cleanupResult = await dlqManager.bulkCleanup();
  console.log(`Cleaned up ${cleanupResult.affectedJobs} jobs`);
}
```

## Error Categories

The DLQ system automatically categorizes errors into the following types:

| Category | Description | Auto-Retryable |
|----------|-------------|----------------|
| `network` | Network connectivity issues | ✅ Yes |
| `timeout` | Processing timeouts | ✅ Yes |
| `rate_limit` | API rate limiting | ✅ Yes |
| `external_api` | External service issues | ✅ Yes |
| `validation` | Data validation errors | ❌ No |
| `permission` | Authorization failures | ❌ No |
| `database` | Database connectivity/errors | ⚠️ Sometimes |
| `memory` | Memory allocation issues | ⚠️ Sometimes |
| `configuration` | Configuration problems | ❌ No |
| `unknown` | Unclassified errors | ⚠️ Sometimes |

## Configuration Options

### Queue-Level DLQ Configuration

```typescript
interface DLQConfig {
  enabled: boolean;                    // Enable/disable DLQ for this queue
  maxRetries: number;                  // Max retries before moving to DLQ
  retentionDays: number;               // How long to keep DLQ jobs
  maxSize?: number;                    // Maximum DLQ size
  autoRequeue?: {
    enabled: boolean;                  // Enable automatic requeue
    attempts: number;                  // Max auto-requeue attempts
    backoffMultiplier: number;         // Backoff multiplier
    maxBackoffMs: number;              // Maximum backoff time
  };
  notification?: {
    enabled: boolean;                  // Enable notifications
    thresholds: {
      count: number;                   // Job count threshold
      timeWindowMs: number;            // Time window for threshold
    };
  };
}
```

### System-Level Configuration

```typescript
const dlqManagerConfig = {
  healthCheckIntervalMs: 5 * 60 * 1000,      // Health check frequency
  maintenanceIntervalMs: 60 * 60 * 1000,     // Maintenance frequency
  autoCleanupEnabled: true,                   // Enable auto-cleanup
  autoCleanupRetentionDays: 30,              // Cleanup retention period
  globalNotificationThresholds: {
    totalJobs: 1000,                         // Global job count threshold
    errorRate: 0.1,                          // Global error rate threshold
    oldestJobDays: 14                        // Oldest job age threshold
  }
};
```

## Monitoring and Alerting

### Health Status Levels

- **🟢 Healthy**: DLQ is operating normally
- **🟡 Warning**: Issues detected but not critical
- **🔴 Critical**: Immediate attention required

### Key Metrics to Monitor

1. **Job Count**: Total jobs in DLQ per queue
2. **Age**: Age of oldest job in DLQ
3. **Error Rate**: Requeue failure rate
4. **Categories**: Distribution of error types
5. **Growth Rate**: Rate of DLQ job accumulation

### Event Monitoring

```typescript
// Monitor DLQ events
dlqManager.on('job-added', ({ queueName, dlqId, job }) => {
  console.log(`New DLQ job: ${dlqId} in ${queueName}`);
});

dlqManager.on('threshold-exceeded', ({ queueName, count, threshold }) => {
  console.log(`ALERT: DLQ threshold exceeded in ${queueName}: ${count}/${threshold}`);
});

dlqManager.on('bulk-cleanup-completed', ({ affectedJobs, success }) => {
  console.log(`Cleanup completed: ${affectedJobs} jobs removed`);
});
```

## Best Practices

### 1. **Configure Appropriate Thresholds**
- Set reasonable job count limits per queue type
- Configure age-based cleanup policies
- Tune auto-requeue parameters based on error patterns

### 2. **Monitor DLQ Health Regularly**
- Set up automated health checks
- Monitor key metrics and trends
- Implement alerting for critical thresholds

### 3. **Analyze Error Patterns**
- Review error categories regularly
- Identify and fix root causes
- Adjust retry policies based on analysis

### 4. **Implement Proper Cleanup**
- Regular cleanup of old jobs
- Appropriate retention policies
- Consider archiving instead of deletion for audit trails

### 5. **Test Requeue Operations**
- Test requeue functionality regularly
- Validate job processing after requeue
- Monitor requeue success rates

## Demo Usage

Run the comprehensive demo to see DLQ functionality:

```bash
# Run the DLQ demo
npm run demo:dlq

# Or run directly with Node.js
node -r ts-node/register shared/queues/demo-dlq.ts
```

The demo will:
1. Create queues with DLQ enabled
2. Add jobs that will fail and move to DLQ
3. Demonstrate monitoring and analysis
4. Show requeue operations
5. Perform health checks and cleanup

## Troubleshooting

### Common Issues

1. **High DLQ Job Count**
   - Check error patterns and categories
   - Review and fix root causes
   - Consider increasing retry limits

2. **Requeue Failures**
   - Verify job processors are working correctly
   - Check for persistent errors in job data
   - Review error categorization logic

3. **Performance Issues**
   - Monitor DLQ size and age
   - Implement regular cleanup
   - Consider increasing cleanup frequency

4. **Memory Usage**
   - Monitor DLQ storage size
   - Implement size limits
   - Use efficient data structures

### Debug Mode

Enable detailed logging for troubleshooting:

```typescript
const dlqManager = new DLQManager({
  // ... other config
  logLevel: 'debug' // Enable debug logging
});
```

## Integration Examples

### With Express.js API

```typescript
app.get('/api/dlq/stats', async (req, res) => {
  const stats = await dlqManager.getSystemStats();
  res.json(stats);
});

app.post('/api/dlq/requeue/:queueName/:dlqId', async (req, res) => {
  const { queueName, dlqId } = req.params;
  const success = await dlqManager.analyzeJob(queueName, dlqId);
  res.json({ success });
});
```

### With Monitoring Systems

```typescript
// Prometheus metrics export
const prometheusMetrics = {
  dlq_jobs_total: new prometheus.Gauge({
    name: 'dlq_jobs_total',
    help: 'Total jobs in DLQ',
    labelNames: ['queue_name']
  }),
  dlq_oldest_job_age: new prometheus.Gauge({
    name: 'dlq_oldest_job_age_seconds',
    help: 'Age of oldest job in DLQ',
    labelNames: ['queue_name']
  })
};

// Update metrics periodically
setInterval(async () => {
  const stats = await dlqManager.getSystemStats();
  Object.entries(stats.queueStats).forEach(([queueName, queueStats]) => {
    prometheusMetrics.dlq_jobs_total.set({ queue_name: queueName }, queueStats.totalJobs);
    if (queueStats.oldestJob) {
      const ageSeconds = (Date.now() - queueStats.oldestJob.getTime()) / 1000;
      prometheusMetrics.dlq_oldest_job_age.set({ queue_name: queueName }, ageSeconds);
    }
  });
}, 30000); // Update every 30 seconds
```

## Conclusion

The Dead Letter Queue system provides enterprise-grade reliability and observability for your queue infrastructure. It ensures no jobs are lost, provides intelligent analysis of failures, and offers comprehensive management capabilities for production environments.

Key benefits:
- **Zero Job Loss**: All failed jobs are captured and preserved
- **Intelligent Analysis**: Automatic error categorization and recommendations
- **Operational Excellence**: Comprehensive monitoring and management tools
- **Production Ready**: Scalable, performant, and battle-tested design

For additional support or questions, refer to the demo implementation in `demo-dlq.ts` or review the comprehensive test suite. 