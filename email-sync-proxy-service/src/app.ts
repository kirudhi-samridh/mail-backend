import * as dotenv from 'dotenv';
import * as path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import fetch from 'node-fetch';
import { eq } from 'drizzle-orm';
import { getDb, users, userEmailAccounts, type UserEmailAccount, type NewUserEmailAccount } from '../../shared/db/connection';

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
  'postmessage'
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

// Routes
const router = express.Router();

// POST /api/auth/google/callback - Handle Google OAuth callback
router.post('/api/auth/google/callback', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const { code } = req.body;
    const saasUserId = req.user!.id;
    
    console.log(`[EMAIL_SVC] Google auth callback for user: ${saasUserId}`);

    if (!code) {
        console.error('[EMAIL_SVC] Auth code missing from request body.');
        res.status(400).json({ message: 'Google authentication code is required.' });
        return;
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);
        
        const { refresh_token, access_token } = tokens;
        if (refresh_token) {
            console.log(`[EMAIL_SVC] Storing Google refresh token for user: ${saasUserId}`);
            
            // Check if user already has a Gmail account connected
            const [existingAccount] = await db
                .select()
                .from(userEmailAccounts)
                .where(eq(userEmailAccounts.userId, saasUserId))
                .limit(1);

            if (existingAccount) {
                // Update existing account
                await db.update(userEmailAccounts)
                    .set({ 
                        refreshToken: refresh_token,
                        updatedAt: new Date()
                    })
                    .where(eq(userEmailAccounts.id, existingAccount.id));
                
                console.log(`[EMAIL_SVC] Updated existing Gmail account for user: ${saasUserId}`);
            } else {
                // Create new email account record
                const newEmailAccount: NewUserEmailAccount = {
                    userId: saasUserId,
                    provider: 'gmail',
                    refreshToken: refresh_token,
                };
                
                await db.insert(userEmailAccounts).values(newEmailAccount);
                console.log(`[EMAIL_SVC] Created new Gmail account record for user: ${saasUserId}`);
            }
        } else {
            console.warn(`[EMAIL_SVC] No new refresh token received for user ${saasUserId}`);
        }
        
        res.status(200).json({ message: 'Google account connected successfully.' });
    } catch (error: any) {
        console.error(`[EMAIL_SVC] Error connecting Google account for user ${saasUserId}:`, error.message);
        res.status(500).json({ message: 'Failed to connect Google account.' });
    }
});

/**
 * Helper function to get an authenticated Gmail client for a user
 * Retrieves the user's Google refresh token from database and creates Gmail API client
 */
async function getGmailClient(saasUserId: string) {
    console.log(`[EMAIL_SVC] Getting Gmail client for user: ${saasUserId}`);
    
    try {
        console.log(`[EMAIL_SVC] Fetching Google refresh token from DB for user: ${saasUserId}`);
        const [emailAccount] = await db
            .select({ refreshToken: userEmailAccounts.refreshToken })
            .from(userEmailAccounts)
            .where(eq(userEmailAccounts.userId, saasUserId))
            .limit(1);

        const refreshToken = emailAccount?.refreshToken;

        if (!refreshToken) {
            console.error(`[EMAIL_SVC] No refresh token found for user: ${saasUserId}`);
            throw new Error('Google account not connected or refresh token missing.');
        }

        console.log(`[EMAIL_SVC] Refresh token found. Initializing OAuth2 client for user: ${saasUserId}`);
        const oauthClient = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID, 
            process.env.GOOGLE_CLIENT_SECRET, 
            'postmessage'
        );
        oauthClient.setCredentials({ refresh_token: refreshToken });
        console.log(`[EMAIL_SVC] Gmail client ready for user: ${saasUserId}`);
        return google.gmail({ version: 'v1', auth: oauthClient });
    } catch (error) {
        console.error(`[EMAIL_SVC] Error getting Gmail client for user ${saasUserId}:`, error);
        throw error;
    }
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

// Health check endpoint
router.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ 
        status: 'healthy', 
        service: 'email-sync-proxy-service',
        timestamp: new Date().toISOString()
    });
});

app.use(router);

app.listen(PORT, () => {
    console.log(`✅ Email Sync Proxy Service running on http://localhost:${PORT}`);
}); 