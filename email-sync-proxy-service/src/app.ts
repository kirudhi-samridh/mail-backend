import * as dotenv from 'dotenv';
import * as path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import fetch from 'node-fetch';
import { eq, and } from 'drizzle-orm';
import { getDb, emailAccounts, type EmailAccount, type NewEmailAccount } from '../../shared/db/connection';
import { summaryQueue } from '../../shared/queues/summaryQueue';
import '../../shared/queues/processors/AISummaryProcessor'; // This ensures the worker starts listening
import { createServer } from 'http';
import { Server } from 'socket.io';

// Load environment variables
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

const app = express();
const PORT = process.env.EMAIL_SERVICE_PORT || 3003;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Get database connection
const db = getDb();

// Google OAuth2 Client Setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.API_GATEWAY_URL || 'http://localhost:3001'}/api/auth/google/callback` // Use the full redirect URI
);

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[EMAIL_SVC] ${req.method} ${req.path}`);
    next();
});

// JWT Authentication Middleware
interface JWTPayload {
    id: string;
    email: string;
    iat: number;
    exp: number;
}

const authenticateJWT = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) {
                console.error('[EMAIL_SVC] JWT Verification Error:', err.message);
                res.status(403).json({ message: 'Invalid or expired token.' });
                return;
            }
            req.user = user as JWTPayload;
            next();
        });
    } else {
        console.warn('[EMAIL_SVC] Auth token not provided.');
        res.status(401).json({ message: 'Authorization token not provided.' });
    }
};

// Extend Express Request type
declare global {
    namespace Express {
        interface Request {
            user?: JWTPayload;
        }
    }
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3000", // Allow the frontend to connect
    methods: ["GET", "POST"]
  }
});

export { io };

// Routes
const router = express.Router();

/**
 * GET /api/auth/status
 * Checks the user's authentication status and connected email services
 */
router.get('/api/auth/status', authenticateJWT, async (req: Request, res: Response) => {
    const userId = req.user!.id;
    console.log(`[EMAIL_SVC] Checking auth status for user: ${userId}`);
    
    try {
        const accounts = await db.query.emailAccounts.findMany({
            where: eq(emailAccounts.userId, userId),
        });

        const googleAccount = accounts.find(a => a.provider === 'google');
        const o365Account = accounts.find(a => a.provider === 'microsoft');
        
        res.status(200).json({
            isAuthenticated: true,
            isGoogleConnected: !!googleAccount,
            isO365Connected: !!o365Account,
            connectedAccounts: accounts.map(a => ({
                id: a.id,
                provider: a.provider,
                emailAddress: a.emailAddress,
                isPrimary: a.isPrimary,
                onboardingCompleted: a.onboardingCompleted,
            })),
            // Onboarding is considered complete if ANY account has finished the process.
            onboardingCompleted: accounts.some(a => a.onboardingCompleted),
        });
    } catch (error: any) {
        console.error(`[EMAIL_SVC] Error checking auth status for user ${userId}:`, error.message);
        res.status(500).json({ message: 'Failed to check authentication status.' });
    }
});

// GET /api/auth/google - Start the Google OAuth flow
router.get('/api/auth/google', authenticateJWT, (req: Request, res: Response) => {
    const scopes = [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
    ];
    
    // Pass the user's ID through the state parameter to link the session
    const state = Buffer.from(JSON.stringify({ userId: req.user!.id })).toString('base64');

    const authorizationUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent', // Force refresh token to be sent every time
        state: state
    });

    res.json({ authorizationUrl });
});


// POST /api/auth/google/callback - Handle Google OAuth callback
router.get('/api/auth/google/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query;
    
    if (!code || !state) {
        res.status(400).send('Missing code or state from Google');
        return;
    }

    let saasUserId: string;
    try {
        const decodedState = JSON.parse(Buffer.from(state as string, 'base64').toString('utf8'));
        saasUserId = decodedState.userId;
        if (!saasUserId) throw new Error('User ID missing from state');
    } catch (e) {
        res.status(400).send('Invalid state parameter');
        return;
    }
    
    console.log(`[EMAIL_SVC] Google auth callback for user: ${saasUserId}`);

    try {
        const { tokens } = await oauth2Client.getToken(code as string);
        
        oauth2Client.setCredentials(tokens);
        
        let emailAddress: string;
        
        // Try Gmail API first (original approach)
        try {
            const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
            const profileResponse = await gmail.users.getProfile({ userId: 'me' });
            emailAddress = profileResponse.data.emailAddress || '';
            
            if (emailAddress) {
                console.log(`[EMAIL_SVC] Retrieved email address from Gmail API: ${emailAddress}`);
            } else {
                throw new Error('No email address from Gmail API');
            }
        } catch (gmailError: any) {
            console.log(`[EMAIL_SVC] Gmail API failed, trying Google+ API: ${gmailError.message}`);
            
            // Fallback to Google+ API
            const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
            const userInfo = await oauth2.userinfo.get();
            emailAddress = userInfo.data.email || '';
            
            if (!emailAddress) {
                throw new Error('Could not retrieve email address from either Gmail or Google+ API');
            }
            
            console.log(`[EMAIL_SVC] Retrieved email address from Google+ API: ${emailAddress}`);
        }

        console.log(`[EMAIL_SVC] Retrieved email address: ${emailAddress} for user ${saasUserId}`);
        
        const existingAccount = await db.query.emailAccounts.findFirst({
            where: and(eq(emailAccounts.userId, saasUserId), eq(emailAccounts.emailAddress, emailAddress)),
        });

        const { refresh_token, access_token, expiry_date } = tokens;
        const finalRefreshToken = refresh_token || existingAccount?.refreshToken;

        if (!finalRefreshToken) {
             console.error('[EMAIL_SVC] No refresh token available.');
             res.status(400).send('Google authentication failed: No refresh token received.');
             return;
        }

        const accountData = {
            userId: saasUserId,
            provider: 'google' as const,
            emailAddress: emailAddress,
            accessToken: access_token || null,
            refreshToken: finalRefreshToken,
            tokenExpiresAt: expiry_date ? new Date(expiry_date) : null,
            updatedAt: new Date(),
        };
        
        let accountId: string;

        if (existingAccount) {
            await db.update(emailAccounts)
                .set(accountData)
                .where(eq(emailAccounts.id, existingAccount.id));
            accountId = existingAccount.id;
            console.log(`[EMAIL_SVC] Successfully updated Google account for user: ${saasUserId}`);
        } else {
            const [newAccount] = await db.insert(emailAccounts).values({
                ...accountData,
                isPrimary: true,
                syncEnabled: true,
                onboardingCompleted: false, // Explicitly set to false on creation
            }).returning({ id: emailAccounts.id });
            accountId = newAccount.id;
            console.log(`[EMAIL_SVC] Successfully stored new Google account for user: ${saasUserId}`);
        }
        
        // Redirect to frontend onboarding page with the account ID
        res.redirect(`http://localhost:3000/onboarding?accountId=${accountId}`);

    } catch (error: any) {
        console.error('[EMAIL_SVC] Error in Google auth callback:', error.message);
        console.error('[EMAIL_SVC] Full error:', error);
        res.status(500).send('Failed to connect Google account.');
    }
});

/**
 * POST /api/accounts/complete-onboarding
 * Marks the user's primary email account as having completed onboarding.
 */
router.post('/api/accounts/complete-onboarding', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { accountId } = req.body; // Expect accountId from the frontend

    if (!accountId) {
        res.status(400).json({ message: 'accountId is required.' });
        return;
    }

    console.log(`[EMAIL_SVC] Received request to complete onboarding for account: ${accountId} for user: ${userId}`);

    try {
        const [accountToUpdate] = await db.update(emailAccounts)
            .set({ onboardingCompleted: true, updatedAt: new Date() })
            .where(and(
                eq(emailAccounts.id, accountId),
                eq(emailAccounts.userId, userId) // Ensure user owns the account
            ))
            .returning();
        
        if (!accountToUpdate) {
            console.error(`[EMAIL_SVC] Account ${accountId} not found for user ${userId}.`);
            return res.status(404).json({ message: 'Account not found or you do not have permission to update it.' });
        }

        console.log(`[EMAIL_SVC] Successfully marked onboarding as complete for account: ${accountToUpdate.emailAddress}`);
        res.status(200).json({ message: 'Onboarding completed successfully.' });

    } catch (error: any) {
        console.error(`[EMAIL_SVC] Error completing onboarding for user ${userId}:`, error.message);
        res.status(500).json({ message: 'Failed to update onboarding status.' });
    }
});


/**
 * Helper function to get an authenticated Gmail client for a user
 * Retrieves the user's Google refresh token from database and creates Gmail API client
 */
async function getGmailClient(saasUserId: string) {
    console.log(`[EMAIL_SVC] Getting Gmail client for user: ${saasUserId}`);

    const emailAccount = await db.query.emailAccounts.findFirst({
        where: and(
            eq(emailAccounts.userId, saasUserId),
            eq(emailAccounts.provider, 'google')
        ),
        orderBy: (accounts, { desc }) => [desc(accounts.createdAt)],
    });

    if (!emailAccount || !emailAccount.refreshToken) {
        console.error(`[EMAIL_SVC] No Google account or refresh token found for user: ${saasUserId}`);
        throw new Error('Google account not connected or refresh token missing.');
    }

    const oauthClient = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        'postmessage'
    );

    oauthClient.setCredentials({
        refresh_token: emailAccount.refreshToken,
        access_token: emailAccount.accessToken,
        expiry_date: emailAccount.tokenExpiresAt ? emailAccount.tokenExpiresAt.getTime() : null,
    });

    // Check if token is expired or about to expire (e.g., within the next minute)
    const isTokenExpired = emailAccount.tokenExpiresAt ? emailAccount.tokenExpiresAt.getTime() < (Date.now() + 60000) : true;

    if (isTokenExpired) {
        console.log(`[EMAIL_SVC] Access token expired or is expiring for user ${saasUserId}. Refreshing...`);
        try {
            const { credentials } = await oauthClient.refreshAccessToken();
            oauthClient.setCredentials(credentials);

            const newAccessToken = credentials.access_token;
            const newExpiryDate = credentials.expiry_date;

            console.log(`[EMAIL_SVC] Token refreshed successfully for user ${saasUserId}.`);

            await db.update(emailAccounts).set({
                accessToken: newAccessToken || null,
                tokenExpiresAt: newExpiryDate ? new Date(newExpiryDate) : null,
                updatedAt: new Date(),
            }).where(eq(emailAccounts.id, emailAccount.id));

            console.log(`[EMAIL_SVC] Persisted new token for user ${saasUserId}.`);
        } catch (refreshError: any) {
            console.error(`[EMAIL_SVC] Failed to refresh access token for user ${saasUserId}:`, refreshError.message);
            // This could be a sign that the user revoked access.
            // We should probably guide them to re-authenticate.
            throw new Error(`Failed to refresh Google access token. Please try reconnecting your account. Reason: ${refreshError.message}`);
        }
    } else {
        console.log(`[EMAIL_SVC] Existing access token is valid for user ${saasUserId}.`);
    }

    console.log(`[EMAIL_SVC] Gmail client ready for user: ${saasUserId}`);
    return google.gmail({ version: 'v1', auth: oauthClient });
}

/**
 * GET /api/labels
 * Fetches Gmail labels for the user
 */
router.get('/api/labels', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    console.log(`[EMAIL_SVC] Received request to fetch labels for user: ${userId}`);
    
    try {
        const gmail = await getGmailClient(userId);
        console.log(`[EMAIL_SVC] Fetching Gmail labels for user: ${userId}`);
        
        const response = await gmail.users.labels.list({ userId: 'me' });
        const labels = response.data.labels || [];
        
        // Filter and format labels - focus on system labels and user-created ones
        const filteredLabels = labels
            .filter(label => 
                label.type === 'system' && 
                ['INBOX', 'SENT', 'DRAFT', 'TRASH', 'SPAM', 'STARRED'].includes(label.id!) ||
                label.type === 'user'
            )
            .map(label => ({
                id: label.id!,
                name: label.name!
            }));
        
        console.log(`[EMAIL_SVC] Successfully fetched ${filteredLabels.length} labels for user: ${userId}`);
        res.status(200).json({ labels: filteredLabels });
    } catch (error: any) {
        console.error(`[EMAIL_SVC] Error fetching Gmail labels for user ${userId}:`, error.message);
        res.status(500).json({ message: 'Failed to fetch labels.' });
    }
});

/**
 * GET /api/emails
 * Fetches the user's Gmail messages from specified label (or inbox by default)
 */
router.get('/api/emails', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const labelId = req.query.labelId as string || 'INBOX';
    console.log(`[EMAIL_SVC] Received request to fetch emails from ${labelId} for user: ${userId}`);
    
    try {
        const gmail = await getGmailClient(userId);
        console.log(`[EMAIL_SVC] Fetching message list from ${labelId} for user: ${userId}`);
        
        const response = await gmail.users.messages.list({ 
            userId: 'me', 
            labelIds: [labelId], 
            maxResults: 15 
        });
        
        const messages = response.data.messages || [];
        console.log(`[EMAIL_SVC] Found ${messages.length} messages in ${labelId} for user: ${userId}. Fetching details...`);

        const detailedMessages = await Promise.all(messages.map(async (message) => {
            const msg = await gmail.users.messages.get({ 
                userId: 'me', 
                id: message.id!, 
                format: 'metadata', 
                metadataHeaders: ['Subject', 'From', 'Date'] 
            });
            
            const headers = msg.data.payload?.headers || [];
            return {
                id: msg.data.id!,
                snippet: msg.data.snippet || '',
                subject: headers.find(h => h.name === 'Subject')?.value || 'No Subject',
                from: headers.find(h => h.name === 'From')?.value || 'Unknown Sender',
                date: headers.find(h => h.name === 'Date')?.value || '',
            };
        }));
        
        console.log(`[EMAIL_SVC] Successfully fetched details for ${detailedMessages.length} emails from ${labelId} for user: ${userId}`);
        res.status(200).json({ messages: detailedMessages });
    } catch (error: any) {
        console.error(`[EMAIL_SVC] Error fetching Gmail messages for user ${userId}:`, error.message);
        res.status(500).json({ message: 'Failed to fetch emails.' });
    }
});

/**
 * GET /api/emails/:emailId
 * Fetches full content of a specific email by ID
 */
router.get('/api/emails/:emailId', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const { emailId } = req.params;
    const userId = req.user!.id;
    console.log(`[EMAIL_SVC] Received request to fetch email ID: ${emailId} for user: ${userId}`);
    
    try {
        const gmail = await getGmailClient(userId);
        console.log(`[EMAIL_SVC] Fetching full email content for ID: ${emailId}`);
        
        const msg = await gmail.users.messages.get({ 
            userId: 'me', 
            id: emailId, 
            format: 'full' 
        });
        
        let body = '';
        const payload = msg.data.payload;

        // Helper function to recursively find email body in MIME parts
        function findPart(parts: any[], mimeType: string): string | null {
            for (const part of parts) {
                if (part.mimeType === mimeType && part.body && part.body.data) {
                    return part.body.data;
                }
                if (part.parts) {
                    const found = findPart(part.parts, mimeType);
                    if (found) return found;
                }
            }
            return null;
        }

        // Extract email body (prefer HTML, fallback to plain text)
        let encodedBody: string | null = null;
        if (payload?.parts) {
            encodedBody = findPart(payload.parts, 'text/html') || findPart(payload.parts, 'text/plain');
        } else if (payload?.body?.data) {
            encodedBody = payload.body.data;
        }

        if (encodedBody) {
            body = Buffer.from(encodedBody, 'base64').toString('utf-8');
            console.log(`[EMAIL_SVC] Successfully decoded email body for ID: ${emailId}`);
        } else {
            console.warn(`[EMAIL_SVC] Could not find email body for ID: ${emailId}`);
        }

        const headers = payload?.headers || [];
        const emailData = {
            id: msg.data.id!,
            snippet: msg.data.snippet || '',
            subject: headers.find(h => h.name?.toLowerCase() === 'subject')?.value || 'No Subject',
            from: headers.find(h => h.name?.toLowerCase() === 'from')?.value || 'Unknown Sender',
            date: headers.find(h => h.name?.toLowerCase() === 'date')?.value || '',
            body
        };
        
        console.log(`[EMAIL_SVC] Successfully processed email. Sending response for ID: ${emailId}`);
        res.status(200).json(emailData);
    } catch (error: any) {
        console.error(`[EMAIL_SVC] Error fetching email ${emailId} for user ${userId}:`, error.message);
        res.status(500).json({ message: 'Failed to fetch email content.' });
    }
});

/**
 * POST /api/summarize-batch
 * Receives a list of email IDs and adds them to the summarization queue.
 */
router.post('/api/summarize-batch', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { emailIds } = req.body;

    if (!Array.isArray(emailIds) || emailIds.length === 0) {
        res.status(400).json({ message: 'emailIds must be a non-empty array.' });
        return;
    }

    console.log(`[EMAIL_SVC] Received request to batch summarize ${emailIds.length} emails for user: ${userId}`);

    try {
        const jobs = emailIds.map(emailId => ({
            name: `summarize-email-${emailId}`,
            data: { emailId, userId },
        }));

        await summaryQueue.addBulk(jobs);

        console.log(`[EMAIL_SVC] Successfully queued ${jobs.length} emails for summarization.`);
        res.status(202).json({ 
            message: `Successfully queued ${jobs.length} emails for summarization. The UI will update as they are completed.` 
        });
    } catch (error: any) {
        console.error(`[EMAIL_SVC] Error queuing batch summarization for user ${userId}:`, error.message);
        res.status(500).json({ message: 'Failed to queue emails for summarization.' });
    }
});

// Health check endpoint
router.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ 
        status: 'healthy', 
        service: 'email-sync-proxy-service',
        timestamp: new Date().toISOString()
    });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('[SOCKET.IO] a user connected:', socket.id);

  // Here you could join rooms based on userId for targeted messages
  socket.on('join-room', (userId) => {
    console.log(`[SOCKET.IO] User ${userId} joined room`);
    socket.join(userId);
  });

  socket.on('disconnect', () => {
    console.log('[SOCKET.IO] user disconnected:', socket.id);
  });
});

app.use(router);

// Start server
httpServer.listen(PORT, () => {
    console.log(`[EMAIL_SVC] ✅ Email Sync/Proxy Service running on http://localhost:${PORT}`);
}); 