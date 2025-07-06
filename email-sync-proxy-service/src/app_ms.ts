import * as dotenv from 'dotenv';
import * as path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { eq, and } from 'drizzle-orm';
import { getDb, emailAccounts, type NewEmailAccount } from '../../shared/db/connection';

// Load environment variables
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

const app = express();
const PORT = process.env.MS_EMAIL_SERVICE_PORT || 3005;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Get database connection
const db = getDb();

// Microsoft OAuth2 Configuration
const MS_CLIENT_ID = process.env.MS_CLIENT_ID;
const MS_CLIENT_SECRET = process.env.MS_CLIENT_SECRET;
const MS_TENANT_ID = process.env.MS_TENANT_ID || 'common';
const MS_REDIRECT_URI = process.env.MS_REDIRECT_URI || 'postmessage';

// Microsoft Graph API endpoints
const MS_GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const MS_TOKEN_ENDPOINT = `https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[MS_EMAIL_SVC] ${req.method} ${req.path}`);
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
                console.error('[MS_EMAIL_SVC] JWT Verification Error:', err.message);
                res.status(403).json({ message: 'Invalid or expired token.' });
                return;
            }
            req.user = user as JWTPayload;
            next();
        });
    } else {
        console.warn('[MS_EMAIL_SVC] Auth token not provided.');
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

/**
 * Helper function to get a fresh access token using refresh token
 */
async function getAccessToken(refreshToken: string): Promise<string> {
            const tokenParams = new URLSearchParams({
            client_id: MS_CLIENT_ID!,
            client_secret: MS_CLIENT_SECRET!,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadBasic https://graph.microsoft.com/User.Read'
        });

    const response = await fetch(MS_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: tokenParams
    });

    if (!response.ok) {
        const errorData = await response.text();
        console.error('[MS_EMAIL_SVC] Token refresh failed:', errorData);
        throw new Error('Failed to refresh access token');
    }

    const tokenData = await response.json();
    return tokenData.access_token;
}

/**
 * Helper function to make authenticated requests to Microsoft Graph API
 */
async function makeGraphRequest(saasUserId: string, endpoint: string, method: string = 'GET', body?: any) {
    console.log(`[MS_EMAIL_SVC] Making Graph API request for user: ${saasUserId}, endpoint: ${endpoint}`);
    
    try {
        // Get refresh token from database
        const [emailAccount] = await db
            .select({ refreshToken: emailAccounts.refreshToken })
            .from(emailAccounts)
            .where(and(eq(emailAccounts.userId, saasUserId), eq(emailAccounts.provider, 'outlook')))
            .limit(1);

        const refreshToken = emailAccount?.refreshToken;
        if (!refreshToken) {
            throw new Error('Microsoft account not connected or refresh token missing.');
        }

        // Get fresh access token
        const accessToken = await getAccessToken(refreshToken);

        // Make the API request
        const headers: any = {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        };

        const requestOptions: any = {
            method,
            headers
        };

        if (body && method !== 'GET') {
            requestOptions.body = JSON.stringify(body);
        }

        const response = await fetch(`${MS_GRAPH_BASE_URL}${endpoint}`, requestOptions);
        
        if (!response.ok) {
            const errorData = await response.text();
            console.error(`[MS_EMAIL_SVC] Graph API request failed: ${response.status} ${response.statusText}`, errorData);
            throw new Error(`Graph API request failed: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error(`[MS_EMAIL_SVC] Error making Graph request for user ${saasUserId}:`, error);
        throw error;
    }
}

// Handle Microsoft OAuth callback - supports both GET and POST
const handleMicrosoftCallback = async (req: Request, res: Response): Promise<void> => {
    // Get code from body (POST) or query (GET)
    const code = req.body?.code || req.query?.code as string;
    const saasUserId = req.user!.id;
    
    console.log(`[MS_EMAIL_SVC] Microsoft auth callback for user: ${saasUserId}`);
    console.log(`[MS_EMAIL_SVC] Request method: ${req.method}`);
    console.log(`[MS_EMAIL_SVC] Request body:`, req.body);
    console.log(`[MS_EMAIL_SVC] Request query:`, req.query);
    console.log(`[MS_EMAIL_SVC] Extracted code:`, code);

    if (!code) {
        console.error('[MS_EMAIL_SVC] Auth code missing from request body or query parameters.');
        res.status(400).json({ message: 'Microsoft authentication code is required in body or query parameters.' });
        return;
    }

    try {
        // Exchange authorization code for tokens
        const tokenParams = new URLSearchParams({
            client_id: MS_CLIENT_ID!,
            client_secret: MS_CLIENT_SECRET!,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: MS_REDIRECT_URI,
            scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadBasic https://graph.microsoft.com/User.Read'
        });

        const tokenResponse = await fetch(MS_TOKEN_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: tokenParams
        });

        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.text();
            console.error('[MS_EMAIL_SVC] Token exchange failed:', errorData);
            res.status(500).json({ message: 'Failed to exchange authorization code for tokens.' });
            return;
        }

        const tokens = await tokenResponse.json();
        const { refresh_token, access_token } = tokens;

        if (refresh_token && access_token) {
            console.log(`[MS_EMAIL_SVC] Storing Microsoft refresh token for user: ${saasUserId}`);
            
            // Get user's email address from Microsoft Graph API
            let userEmail = '';
            let displayName = '';
            try {
                const userProfileResponse = await fetch(`${MS_GRAPH_BASE_URL}/me`, {
                    headers: {
                        'Authorization': `Bearer ${access_token}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (userProfileResponse.ok) {
                    const userProfile = await userProfileResponse.json();
                    userEmail = userProfile.mail || userProfile.userPrincipalName || '';
                    displayName = userProfile.displayName || '';
                    console.log(`[MS_EMAIL_SVC] Retrieved user profile for ${saasUserId}: ${userEmail}`);
                } else {
                    console.warn(`[MS_EMAIL_SVC] Could not fetch user profile: ${userProfileResponse.status}`);
                }
            } catch (error) {
                console.error(`[MS_EMAIL_SVC] Error fetching user profile:`, error);
            }
            
            // Check if user already has a Microsoft account connected
            const [existingAccount] = await db
                .select()
                .from(emailAccounts)
                .where(and(eq(emailAccounts.userId, saasUserId), eq(emailAccounts.provider, 'outlook')))
                .limit(1);

            if (existingAccount) {
                // Update existing account
                await db.update(emailAccounts)
                    .set({ 
                        refreshToken: refresh_token,
                        emailAddress: userEmail || existingAccount.emailAddress,
                        displayName: displayName || existingAccount.displayName,
                        updatedAt: new Date()
                    })
                    .where(eq(emailAccounts.id, existingAccount.id));
                
                console.log(`[MS_EMAIL_SVC] Updated existing Microsoft account for user: ${saasUserId}`);
            } else {
                // Create new email account record
                const newEmailAccount: NewEmailAccount = {
                    userId: saasUserId,
                    provider: 'outlook',
                    emailAddress: userEmail || 'unknown@outlook.com',
                    displayName: displayName || null,
                    refreshToken: refresh_token,
                };
                
                await db.insert(emailAccounts).values(newEmailAccount);
                console.log(`[MS_EMAIL_SVC] Created new Microsoft account record for user: ${saasUserId} with email: ${userEmail}`);
            }
        } else {
            console.warn(`[MS_EMAIL_SVC] No refresh token or access token received for user ${saasUserId}`);
        }
        
        res.status(200).json({ message: 'Microsoft account connected successfully.' });
    } catch (error: any) {
        console.error(`[MS_EMAIL_SVC] Error connecting Microsoft account for user ${saasUserId}:`, error.message);
        res.status(500).json({ message: 'Failed to connect Microsoft account.' });
    }
};

/**
 * GET /api/auth/microsoft/authorize
 * Generates Microsoft OAuth authorization URL
 */
router.get('/api/auth/microsoft/authorize', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    console.log(`[MS_EMAIL_SVC] Generating Microsoft OAuth URL for user: ${userId}`);
    
    try {
        // Generate a state parameter for CSRF protection
        const state = 'microsoft_auth';
        
        // Construct the Microsoft OAuth authorization URL
        const authUrl = new URL(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/authorize`);
        authUrl.searchParams.set('client_id', MS_CLIENT_ID!);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('redirect_uri', process.env.MS_REDIRECT_URI || 'http://localhost:3000');
        authUrl.searchParams.set('scope', 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadBasic https://graph.microsoft.com/User.Read');
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('response_mode', 'query');
        
        console.log(`[MS_EMAIL_SVC] Generated OAuth URL for user ${userId}: ${authUrl.toString()}`);
        res.status(200).json({ authUrl: authUrl.toString() });
    } catch (error: any) {
        console.error(`[MS_EMAIL_SVC] Error generating Microsoft OAuth URL for user ${userId}:`, error.message);
        res.status(500).json({ message: 'Failed to generate Microsoft authorization URL.' });
    }
});

// Register both GET and POST routes for Microsoft auth callback
router.get('/api/auth/microsoft/callback', authenticateJWT, handleMicrosoftCallback);
router.post('/api/auth/microsoft/callback', authenticateJWT, handleMicrosoftCallback);

/**
 * GET /api/ms/folders
 * Fetches Outlook mail folders for the user
 */
router.get('/api/ms/folders', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    console.log(`[MS_EMAIL_SVC] Received request to fetch folders for user: ${userId}`);
    
    try {
        const response = await makeGraphRequest(userId, '/me/mailFolders');
        const folders = response.value || [];
        
        // Filter and format folders - focus on system folders
        const filteredFolders = folders
            .filter((folder: any) => 
                ['Inbox', 'SentItems', 'Drafts', 'DeletedItems', 'JunkEmail'].includes(folder.displayName) ||
                folder.wellKnownName
            )
            .map((folder: any) => ({
                id: folder.id,
                name: folder.displayName
            }));
        
        console.log(`[MS_EMAIL_SVC] Successfully fetched ${filteredFolders.length} folders for user: ${userId}`);
        res.status(200).json({ folders: filteredFolders });
    } catch (error: any) {
        console.error(`[MS_EMAIL_SVC] Error fetching Outlook folders for user ${userId}:`, error.message);
        res.status(500).json({ message: 'Failed to fetch folders.' });
    }
});

/**
 * GET /api/ms/emails
 * Fetches the user's Outlook messages from specified folder (or inbox by default)
 */
router.get('/api/ms/emails', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const folderId = req.query.folderId as string;
    console.log(`[MS_EMAIL_SVC] Received request to fetch emails from folder ${folderId || 'inbox'} for user: ${userId}`);
    
    try {
        let endpoint = '/me/messages';
        if (folderId) {
            endpoint = `/me/mailFolders/${folderId}/messages`;
        }
        endpoint += '?$top=15&$select=id,subject,from,receivedDateTime,bodyPreview';
        
        const response = await makeGraphRequest(userId, endpoint);
        const messages = response.value || [];
        
        const detailedMessages = messages.map((message: any) => ({
            id: message.id,
            snippet: message.bodyPreview || '',
            subject: message.subject || 'No Subject',
            from: message.from?.emailAddress?.address || 'Unknown Sender',
            date: message.receivedDateTime || '',
        }));
        
        console.log(`[MS_EMAIL_SVC] Successfully fetched ${detailedMessages.length} emails for user: ${userId}`);
        res.status(200).json({ messages: detailedMessages });
    } catch (error: any) {
        console.error(`[MS_EMAIL_SVC] Error fetching Outlook messages for user ${userId}:`, error.message);
        res.status(500).json({ message: 'Failed to fetch emails.' });
    }
});

/**
 * GET /api/ms/emails/:emailId
 * Fetches full content of a specific email by ID
 */
router.get('/api/ms/emails/:emailId', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const { emailId } = req.params;
    const userId = req.user!.id;
    console.log(`[MS_EMAIL_SVC] Received request to fetch email ID: ${emailId} for user: ${userId}`);
    
    try {
        const endpoint = `/me/messages/${emailId}?$select=id,subject,from,receivedDateTime,body,bodyPreview`;
        const message = await makeGraphRequest(userId, endpoint);
        
        const emailData = {
            id: message.id,
            snippet: message.bodyPreview || '',
            subject: message.subject || 'No Subject',
            from: message.from?.emailAddress?.address || 'Unknown Sender',
            date: message.receivedDateTime || '',
            body: message.body?.content || message.bodyPreview || ''
        };
        
        console.log(`[MS_EMAIL_SVC] Successfully processed email. Sending response for ID: ${emailId}`);
        res.status(200).json(emailData);
    } catch (error: any) {
        console.error(`[MS_EMAIL_SVC] Error fetching email ${emailId} for user ${userId}:`, error.message);
        res.status(500).json({ message: 'Failed to fetch email content.' });
    }
});

// Health check endpoint
router.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ 
        status: 'healthy', 
        service: 'ms-email-sync-proxy-service',
        timestamp: new Date().toISOString()
    });
});

app.use(router);

app.listen(PORT, () => {
    console.log(`✅ Microsoft Email Sync Proxy Service running on http://localhost:${PORT}`);
}); 