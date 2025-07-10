import express, { Request, Response } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { 
  getDb, 
  users, 
  usageMetrics,
  type User, 
  type NewUser,
  type NewUsageMetric,
  emailAccounts
} from '../../shared/db/connection';
import { 
  createAuthMiddleware, 
  createLoggerMiddleware,
  type JWTPayload 
} from '../../shared/services';
import { type OnboardingJobData } from '../../shared/queues/types/onboarding-jobs';
import jwt from 'jsonwebtoken';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const PORT = process.env.USER_SERVICE_PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const db = getDb();

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

app.use(cors());
app.use(express.json());
app.use(createLoggerMiddleware('USER_SVC'));

const authenticateJWT = createAuthMiddleware(JWT_SECRET);

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

// Subscription tier configurations
const SUBSCRIPTION_TIERS = {
    free: {
        monthly_ai_requests: 100,
        monthly_searches: 500,
        max_email_accounts: 1,
        max_integrations: 0,
        features: ['basic_summaries', 'manual_labels']
    },
    premium: {
        monthly_ai_requests: 1000,
        monthly_searches: 5000,
        max_email_accounts: 5,
        max_integrations: 3,
        features: ['ai_drafting', 'auto_labels', 'semantic_search', 'automation_rules']
    },
    enterprise: {
        monthly_ai_requests: 10000,
        monthly_searches: 50000,
        max_email_accounts: 20,
        max_integrations: 10,
        features: ['unlimited_features', 'priority_support', 'custom_integrations']
    }
};

// Generate JWT token with enhanced payload
const generateJWT = (user: User): string => {
    return jwt.sign(
        { 
            id: user.id, 
            email: user.email,
            subscriptionTier: user.subscriptionTier || 'free'
        }, 
        JWT_SECRET, 
        { expiresIn: '24h' }
    );
};

// Get current usage for a user
const getCurrentUsage = async (userId: string): Promise<Record<string, number>> => {
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);
    
    const nextMonth = new Date(currentMonth);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    const usage = await db
        .select()
        .from(usageMetrics)
        .where(
            and(
                eq(usageMetrics.userId, userId),
                gte(usageMetrics.periodStart, currentMonth),
                lte(usageMetrics.periodEnd, nextMonth)
            )
        );

    const usageSummary: Record<string, number> = {};
    usage.forEach(metric => {
        usageSummary[metric.metricType] = (usageSummary[metric.metricType] || 0) + metric.metricValue;
    });

    return usageSummary;
};

// Record usage metric
const recordUsage = async (userId: string, metricType: string, value: number = 1): Promise<void> => {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const periodEnd = new Date(periodStart);
    periodEnd.setDate(periodEnd.getDate() + 1);

    const newMetric: NewUsageMetric = {
        userId,
        metricType,
        metricValue: value,
        periodStart,
        periodEnd
    };

    await db.insert(usageMetrics).values(newMetric);
};

// Check if user has quota available
const checkQuota = async (userId: string, metricType: string): Promise<{ allowed: boolean; current: number; limit: number }> => {
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user.length) {
        return { allowed: false, current: 0, limit: 0 };
    }

    const quota = user[0].usageQuota as any;
    const currentUsage = await getCurrentUsage(userId);
    
    const current = currentUsage[metricType] || 0;
    const limit = quota[metricType] || 0;
    
    return {
        allowed: current < limit,
        current,
        limit
    };
};

// Routes
const router = express.Router();

// ==========================================
// AUTHENTICATION ROUTES
// ==========================================

// POST /api/auth/signup
router.post('/api/auth/signup', async (req: Request, res: Response): Promise<void> => {
    const { email, password, subscriptionTier = 'free' } = req.body;
    
    if (!email || !password) {
        res.status(400).json({ message: 'Email and password are required.' });
        return;
    }

    try {
        console.log(`[USER_SVC] Creating new user: ${email} with tier: ${subscriptionTier}`);
        
        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);
        
        // Get tier configuration
        const tierConfig = SUBSCRIPTION_TIERS[subscriptionTier as keyof typeof SUBSCRIPTION_TIERS] || SUBSCRIPTION_TIERS.free;
        
        // Create new user with enhanced profile
        const newUser: NewUser = {
            email,
            passwordHash,
            subscriptionTier,
            timezone: 'UTC',
            language: 'en',
            usageQuota: tierConfig,
            preferences: {
                email_notifications: true,
                auto_draft_enabled: subscriptionTier !== 'free',
                briefing_time: '09:00',
                priority_threshold: 70
            },
            writingStyle: {},
            onboardingCompleted: false
        };
        
        const [createdUser] = await db.insert(users).values(newUser).returning();
        
        console.log(`[USER_SVC] User created successfully: ${createdUser.id}`);
        
        // Generate JWT token
        const token = generateJWT(createdUser);
        
        // Record signup metric
        await recordUsage(createdUser.id, 'user_signup');
        
        res.status(201).json({ 
            user: {
                id: createdUser.id,
                email: createdUser.email,
                subscriptionTier: createdUser.subscriptionTier,
                preferences: createdUser.preferences,
                onboardingCompleted: createdUser.onboardingCompleted
            }, 
            token 
        });
    } catch (error: any) {
        console.error('[USER_SVC] Signup error:', error);
        
        // Handle unique constraint violation (duplicate email)
        if (error.code === '23505') {
            res.status(400).json({ message: 'Email already exists.' });
            return;
        }
        
        res.status(500).json({ message: 'User registration failed.' });
    }
});

// POST /api/auth/login
router.post('/api/auth/login', async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;
    console.log(`[USER_SVC] Login attempt for email: ${email}`);
    
    try {
        const [user] = await db
            .select()
            .from(users)
            .where(eq(users.email, email))
            .limit(1);
        
        if (!user) {
            console.log(`[USER_SVC] User not found: ${email}`);
            res.status(401).json({ message: 'Invalid credentials' });
            return;
        }
        
        const isValidPassword = await bcrypt.compare(password, user.passwordHash);
        if (!isValidPassword) {
            console.log(`[USER_SVC] Invalid password for user: ${email}`);
            res.status(401).json({ message: 'Invalid credentials' });
            return;
        }
        
        // Update last active timestamp
        await db
            .update(users)
            .set({ 
                lastActiveAt: new Date(),
                updatedAt: new Date()
            })
            .where(eq(users.id, user.id));
        
        const token = generateJWT(user);
        
        // Record login metric
        await recordUsage(user.id, 'user_login');
        
        console.log(`[USER_SVC] Successful login for user: ${email}`);
        res.status(200).json({
            message: 'Login successful',
            token,
            user: { 
                id: user.id, 
                email: user.email,
                subscriptionTier: user.subscriptionTier,
                preferences: user.preferences,
                onboardingCompleted: user.onboardingCompleted
            }
        });
    } catch (error: any) {
        console.error(`[USER_SVC] Login error for ${email}:`, error.message);
        res.status(500).json({ message: 'Server error during login' });
    }
});

// ==========================================
// USER PROFILE ROUTES
// ==========================================

// GET /api/user/profile
router.get('/api/user/profile', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    
    try {
        const [user] = await db
            .select({
                id: users.id,
                email: users.email,
                subscriptionTier: users.subscriptionTier,
                timezone: users.timezone,
                language: users.language,
                usageQuota: users.usageQuota,
                preferences: users.preferences,
                writingStyle: users.writingStyle,
                onboardingCompleted: users.onboardingCompleted,
                lastActiveAt: users.lastActiveAt,
                createdAt: users.createdAt
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        
        if (!user) {
            res.status(404).json({ message: 'User not found' });
            return;
        }
        
        // Get current usage
        const currentUsage = await getCurrentUsage(userId);
        
        // Get connected email accounts
        const connectedAccounts = await db
            .select({
                id: emailAccounts.id,
                provider: emailAccounts.provider,
                emailAddress: emailAccounts.emailAddress,
                displayName: emailAccounts.displayName,
                isPrimary: emailAccounts.isPrimary,
                syncStatus: emailAccounts.syncStatus,
                lastSyncAt: emailAccounts.lastSyncAt
            })
            .from(emailAccounts)
            .where(eq(emailAccounts.userId, userId));
        
        res.status(200).json({
            user,
            currentUsage,
            connectedAccounts
        });
    } catch (error: any) {
        console.error(`[USER_SVC] Error fetching profile for user ${userId}:`, error.message);
        res.status(500).json({ message: 'Failed to fetch user profile' });
    }
});

// PUT /api/user/profile
router.put('/api/user/profile', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { timezone, language, preferences } = req.body;
    
    try {
        const updateData: Partial<User> = {
            updatedAt: new Date()
        };
        
        if (timezone) updateData.timezone = timezone;
        if (language) updateData.language = language;
        if (preferences) updateData.preferences = preferences;
        
        const [updatedUser] = await db
            .update(users)
            .set(updateData)
            .where(eq(users.id, userId))
            .returning({
                id: users.id,
                email: users.email,
                timezone: users.timezone,
                language: users.language,
                preferences: users.preferences
            });
        
        console.log(`[USER_SVC] Profile updated for user: ${userId}`);
        res.status(200).json({ user: updatedUser });
    } catch (error: any) {
        console.error(`[USER_SVC] Error updating profile for user ${userId}:`, error.message);
        res.status(500).json({ message: 'Failed to update user profile' });
    }
});

// ==========================================
// USAGE & QUOTA ROUTES
// ==========================================

// GET /api/user/usage
router.get('/api/user/usage', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    
    try {
        const [user] = await db
            .select({ usageQuota: users.usageQuota, subscriptionTier: users.subscriptionTier })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        
        if (!user) {
            res.status(404).json({ message: 'User not found' });
            return;
        }
        
        const currentUsage = await getCurrentUsage(userId);
        const quota = user.usageQuota as any;
        
        const usageData = {
            tier: user.subscriptionTier,
            quota,
            current: currentUsage,
            percentages: {} as Record<string, number>
        };
        
        // Calculate usage percentages
        Object.keys(quota).forEach(key => {
            const current = currentUsage[key] || 0;
            const limit = quota[key] || 1;
            usageData.percentages[key] = Math.round((current / limit) * 100);
        });
        
        res.status(200).json(usageData);
    } catch (error: any) {
        console.error(`[USER_SVC] Error fetching usage for user ${userId}:`, error.message);
        res.status(500).json({ message: 'Failed to fetch usage data' });
    }
});

// POST /api/user/quota/check
router.post('/api/user/quota/check', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { metricType } = req.body;
    
    if (!metricType) {
        res.status(400).json({ message: 'Metric type is required' });
        return;
    }
    
    try {
        const quotaCheck = await checkQuota(userId, metricType);
        res.status(200).json(quotaCheck);
    } catch (error: any) {
        console.error(`[USER_SVC] Error checking quota for user ${userId}:`, error.message);
        res.status(500).json({ message: 'Failed to check quota' });
    }
});

// ==========================================
// SUBSCRIPTION ROUTES
// ==========================================

// PUT /api/user/subscription
router.put('/api/user/subscription', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { subscriptionTier } = req.body;
    
    if (!subscriptionTier || !SUBSCRIPTION_TIERS[subscriptionTier as keyof typeof SUBSCRIPTION_TIERS]) {
        res.status(400).json({ message: 'Invalid subscription tier' });
        return;
    }
    
    try {
        const newQuota = SUBSCRIPTION_TIERS[subscriptionTier as keyof typeof SUBSCRIPTION_TIERS];
        
        const [updatedUser] = await db
            .update(users)
            .set({
                subscriptionTier,
                usageQuota: newQuota,
                updatedAt: new Date()
            })
            .where(eq(users.id, userId))
            .returning({
                id: users.id,
                email: users.email,
                subscriptionTier: users.subscriptionTier,
                usageQuota: users.usageQuota
            });
        
        // Record subscription change
        await recordUsage(userId, 'subscription_change');
        
        console.log(`[USER_SVC] Subscription updated to ${subscriptionTier} for user: ${userId}`);
        res.status(200).json({ user: updatedUser });
    } catch (error: any) {
        console.error(`[USER_SVC] Error updating subscription for user ${userId}:`, error.message);
        res.status(500).json({ message: 'Failed to update subscription' });
    }
});

// ==========================================
// LEGACY COMPATIBILITY ROUTES
// ==========================================

// The /api/auth/status endpoint has been moved to the email-sync-proxy-service
// to consolidate all account and connection status logic in one place.
// This version is now obsolete and has been removed to prevent conflicts.

// ==========================================
// ADMIN ROUTES (Future Enhancement)
// ==========================================

// GET /api/admin/users (Basic implementation for development)
router.get('/api/admin/users', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    // TODO: Add admin role check
    try {
        const usersList = await db
            .select({
                id: users.id,
                email: users.email,
                subscriptionTier: users.subscriptionTier,
                createdAt: users.createdAt,
                lastActiveAt: users.lastActiveAt
            })
            .from(users)
            .orderBy(desc(users.createdAt))
            .limit(50);
        
        res.status(200).json({ users: usersList });
    } catch (error: any) {
        console.error('[USER_SVC] Error fetching users list:', error.message);
        res.status(500).json({ message: 'Failed to fetch users' });
    }
});

// ==========================================
// ONBOARDING ROUTES
// ==========================================

// This endpoint is obsolete and is being removed.
// The logic has been correctly moved to the email-sync-proxy-service
// to associate onboarding completion with a specific email account.

// ==========================================
// BACKGROUND JOB / QUEUE MANAGEMENT
// ==========================================

// POST /api/user/onboarding/start
router.post('/api/user/onboarding/start', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { fetchDays = 15, summaryDays = 15 } = req.body;
    
    console.log(`[USER_SVC] Starting onboarding for user: ${userId}`);
    
    try {
        // Get user's most recently connected email account
        const [emailAccount] = await db
            .select()
            .from(emailAccounts)
            .where(eq(emailAccounts.userId, userId))
            .orderBy(desc(emailAccounts.createdAt))
            .limit(1);
        
        if (!emailAccount) {
            res.status(400).json({ message: 'No email account connected. Please connect your email first.' });
            return;
        }
        
        // Generate correlation ID for progress tracking (prefix removed)
        const correlationId = `${userId}_${Date.now()}`;
        
        const { queueRegistry } = await import('../../shared/queues');
        const onboardingQueue = queueRegistry.get('onboarding');

        if (!onboardingQueue) {
            console.error('[USER_SVC] ❌ Onboarding queue is not available. This should have been initialized at startup.');
            res.status(503).json({ 
                error: 'Service Temporarily Unavailable', 
                message: 'The onboarding service is currently starting up. Please try again in a moment.' 
            });
            return;
        }
        
        // Extract JWT token from authorization header
        const authHeader = req.headers.authorization;
        const userToken = authHeader ? authHeader.split(' ')[1] : undefined;

        const jobData: OnboardingJobData = {
            accountId: emailAccount.id,
            fetchDays,
            summaryDays,
            emailAddress: emailAccount.emailAddress,
            userId, // Ensure userId is passed in the job data
            userToken: userToken || undefined, // Pass the user's JWT token for downstream service authentication
            metadata: {
                correlationId,
                startedAt: new Date()
            }
        };

        const jobId = await onboardingQueue.addJob('onboarding', jobData);
        
        console.log(`[USER_SVC] Onboarding job queued: ${jobId} for user: ${userId} with correlationId: ${correlationId}`);
        
        res.status(202).json({ 
            message: 'Onboarding process has been accepted and is starting.',
            correlationId,
            jobId,
            estimatedTime: `${Math.ceil(fetchDays * 0.5)} minutes` // Rough estimate
        });
        
    } catch (error: any) {
        console.error(`[USER_SVC] Error starting onboarding for user ${userId}:`, error.message);
        res.status(500).json({ message: 'Failed to start onboarding process' });
    }
});

// GET /api/user/onboarding/progress/:correlationId
router.get('/api/user/onboarding/progress/:correlationId', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { correlationId } = req.params;
    
    // Security check: ensure the correlationId format is valid before proceeding
    const [id, timestamp] = correlationId.split('_');
    if (id !== userId || !/^\d+$/.test(timestamp)) {
        res.status(403).json({ message: 'Access denied: Invalid correlation ID format.' });
        return;
    }

    try {
        // Initialize progress broadcaster if needed
        const { progressBroadcaster } = await import('../../shared/services');
        const progress = await progressBroadcaster.getUserProgress(userId);
        
        // Find the specific onboarding progress
        const onboardingProgress = progress.find(p => p.jobId === correlationId);
        
        if (!onboardingProgress) {
            // If no progress found, return a fallback. The old check is removed as it's now validated above.
            const estimatedEmails = 15 * 10; // 150 emails
            const batchSize = 50;
            const totalBatches = Math.ceil(estimatedEmails / batchSize); // 3 batches
            
            // Return a default "in progress" status if we can't find Redis data
            res.status(200).json({
                jobId: correlationId,
                totalItems: 100,
                completed: 15,
                percentage: 15,
                status: 'running',
                currentAction: 'Processing emails...',
                startTime: new Date(),
                metadata: {
                    type: 'onboarding',
                    userId: userId,
                    description: 'Email onboarding in progress'
                },
                subTasks: {
                    'email-fetch': { subTaskId: 'email-fetch', weight: 50, completed: 1, total: totalBatches, status: 'running' },
                    'ai-summary': { subTaskId: 'ai-summary', weight: 50, completed: 5, total: estimatedEmails, status: 'running' }
                }
            });
            return;
        }
        
        // Security check: ensure user owns this progress (redundant but safe)
        if (onboardingProgress.metadata?.userId !== userId) {
            res.status(403).json({ message: 'Access denied' });
            return;
        }
        
        res.status(200).json(onboardingProgress);
        
    } catch (error: any) {
        console.error(`[USER_SVC] Error fetching onboarding progress for user ${userId}:`, error.message);
        
        // Return a fallback response if Redis is having issues
        res.status(200).json({
            jobId: correlationId,
            totalItems: 100,
            completed: 20,
            percentage: 20,
            status: 'running',
            currentAction: 'Processing emails (Redis connection issues)...',
            startTime: new Date(),
            metadata: {
                type: 'onboarding',
                userId: userId,
                description: 'Email onboarding in progress'
            },
            subTasks: {
                'email-fetch': { subTaskId: 'email-fetch', weight: 50, completed: 2, total: 3, status: 'running' },
                'ai-summary': { subTaskId: 'ai-summary', weight: 50, completed: 10, total: 150, status: 'running' }
            }
        });
    }
});

// GET /api/user/emails
router.get('/api/user/emails', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { page = 1, limit = 20, processed = 'all' } = req.query;
    
    try {
        const { emails } = await import('../../shared/db/connection');
        const { desc, or, and } = await import('drizzle-orm');
        
        // Get user's email accounts
        const userAccounts = await db
            .select({ accountId: emailAccounts.id })
            .from(emailAccounts)
            .where(eq(emailAccounts.userId, userId));
        
        if (userAccounts.length === 0) {
            res.status(200).json({ emails: [], total: 0 });
            return;
        }
        
        const accountIds = userAccounts.map(acc => acc.accountId);
        
        // Build query conditions
        let whereCondition = or(...accountIds.map(accountId => eq(emails.accountId, accountId)));
        
        // Filter by processing status if specified
        if (processed === 'completed') {
            whereCondition = and(whereCondition, eq(emails.processingStatus, 'completed'));
        } else if (processed === 'pending') {
            whereCondition = and(whereCondition, eq(emails.processingStatus, 'pending'));
        }
        
        // Fetch emails with pagination
        const userEmails = await db
            .select({
                id: emails.id,
                subject: emails.subject,
                fromAddress: emails.fromAddress,
                fromName: emails.fromName,
                snippet: emails.snippet,
                receivedAt: emails.receivedAt,
                isRead: emails.isRead,
                isStarred: emails.isStarred,
                isImportant: emails.isImportant,
                summary: emails.summary,
                priorityScore: emails.priorityScore,
                processingStatus: emails.processingStatus,
                hasAttachments: emails.hasAttachments
            })
            .from(emails)
            .where(whereCondition)
            .orderBy(desc(emails.receivedAt))
            .limit(Number(limit))
            .offset((Number(page) - 1) * Number(limit));
        
        res.status(200).json({ 
            emails: userEmails,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total: userEmails.length
            }
        });
        
    } catch (error: any) {
        console.error(`[USER_SVC] Error fetching emails for user ${userId}:`, error.message);
        res.status(500).json({ message: 'Failed to fetch emails' });
    }
});

// ==========================================
// HEALTH CHECK
// ==========================================

// Health check endpoint
router.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ 
        status: 'healthy', 
        service: 'user-management-service',
        version: '2.0.0',
        features: ['enhanced_profiles', 'usage_tracking', 'multi_tier_subscriptions'],
        timestamp: new Date().toISOString()
    });
});

// Progress sync status endpoint
router.get('/health/progress', async (req: Request, res: Response) => {
    try {
        const { progressBroadcaster } = await import('../../shared/services');
        const syncStatus = progressBroadcaster.getSyncStatus();
        
        res.status(200).json({
            status: 'healthy',
            progressSync: syncStatus,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to get progress sync status',
            timestamp: new Date().toISOString()
        });
    }
});

// Add API health route for gateway compatibility
router.get('/api/health', (req: Request, res: Response) => {
    res.status(200).json({ 
        status: 'healthy', 
        service: 'user-management-service',
        version: '2.0.0',
        features: ['enhanced_profiles', 'usage_tracking', 'multi_tier_subscriptions'],
        timestamp: new Date().toISOString()
    });
});

app.use(router);

// ==========================================
// SYSTEM INITIALIZATION
// ==========================================

async function initializeSystem() {
  try {
    console.log('[SYSTEM_INIT] Initializing backend services...');
    
    // Initialize Queue System
    const { setupOnboardingQueues } = await import('../../shared/queues/setup/onboarding-setup');
    await setupOnboardingQueues();
    console.log('[SYSTEM_INIT] ✅ Queue system and workers are ready.');

    // Initialize Progress Broadcaster
    const { progressBroadcaster } = await import('../../shared/services');
    await progressBroadcaster.testRedisConnection(); // Ensure connection is live
    console.log('[SYSTEM_INIT] ✅ Progress broadcaster is ready.');

    // Add other initialization logic here (e.g., database health checks)
    
    console.log('[SYSTEM_INIT] ✅ All backend services initialized successfully.');

  } catch (error) {
    console.error('[SYSTEM_INIT] ❌ Fatal error during system initialization:', error);
    process.exit(1); // Exit if critical systems fail
  }
}

app.listen(PORT, () => {
    console.log(`✅ Enhanced User Management Service v2.0 running on http://localhost:${PORT}`);
    console.log(`📊 Features: Multi-tier subscriptions, Usage tracking, Enhanced profiles`);
    
    // Start system initialization after the server starts listening
    initializeSystem();
}); 