// Import necessary modules
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken'); // For JWT token generation and validation
const { Pool } = require('pg'); // For PostgreSQL interaction
// const { Redis } = require('@upstash/redis'); // For Redis (or simple in-memory for demo)

// Placeholder for external authentication (Auth0/Firebase Auth) client
// In a real app, you'd initialize your Auth0/Firebase SDK here
const authClient = {
    signup: async (email, password) => {
        // Simulate Auth0/Firebase user creation
        console.log(`AuthClient: Creating user ${email} in external auth provider.`);
        // In reality, this would be an SDK call, e.g.,
        // await auth0ManagementClient.createUser({ email, password, connection: 'Username-Password-Authentication' });
        if (email === 'fail@example.com') throw new Error('Auth0/Firebase signup failed for demo');
        return { id: `user-${Date.now()}`, email, verified: true };
    },
    login: async (email, password) => {
        // Simulate Auth0/Firebase user verification
        console.log(`AuthClient: Verifying user ${email} credentials with external auth provider.`);
        // In reality, this would be an SDK call, e.g.,
        // const authResult = await auth0AuthenticationClient.passwordGrant({ username: email, password });
        if (email === 'fail@example.com' || password !== 'password123') throw new Error('Auth0/Firebase login failed for demo');
        return { id: `user-${Date.now()}`, email, verified: true };
    },
    // Placeholder for Google/Microsoft OAuth client
    // In a real app, you'd use a library like 'passport-google-oauth20' or 'msal-node'
    initiateOAuth: (provider) => {
        // This is where you'd redirect to Google/Microsoft's OAuth consent screen
        // Example: https://accounts.google.com/o/oauth2/v2/auth?...
        // For demo, we'll simulate a direct callback after a delay.
        return `Simulated_OAuth_URL_for_${provider}`;
    },
    exchangeCodeForTokens: async (provider, code) => {
        // Simulate exchanging the auth code for access/refresh tokens
        console.log(`AuthClient: Exchanging code for tokens with ${provider} using code ${code}.`);
        if (code === 'invalid_code') throw new Error('Invalid OAuth code');
        return {
            access_token: `${provider}_access_token_abc${Date.now()}`,
            refresh_token: `${provider}_refresh_token_xyz${Date.now()}`,
            expires_in: 3600, // 1 hour
        };
    },
    refreshAccessToken: async (provider, refreshToken) => {
        // Simulate refreshing an expired access token
        console.log(`AuthClient: Refreshing access token for ${provider}.`);
        if (refreshToken.includes('invalid')) throw new Error('Invalid refresh token');
        return {
            access_token: `${provider}_new_access_token_abc${Date.now()}`,
            expires_in: 3600,
        };
    }
};

// Placeholder for Google and Microsoft Email API clients
const emailApiClients = {
    google: {
        fetchInbox: async (accessToken, userId) => {
            console.log(`Google API: Fetching inbox for user ${userId} with token ${accessToken}`);
            // Simulate API call to Google Gmail API
            await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
            return [
                { id: `g_mail_1_${Date.now()}`, from: 'alice@example.com', to: 'user@saas.com', subject: 'Your Project Update', snippet: 'Hi, just wanted to give you an update on the project status. We are on track...',
                  body: 'Hi team, \n\nJust wanted to provide a quick update on the Q3 project. We have completed the initial phase of development and are now moving into testing. Alice has done a great job leading the front-end tasks, and Bob is making good progress on the backend. We anticipate hitting our next milestone by end of next week. Please review the attached document for detailed progress. \n\nBest, \nProject Manager' },
                { id: `g_mail_2_${Date.now()}`, from: 'newsletter@news.com', to: 'user@saas.com', subject: 'Weekly Tech News', snippet: 'This week in tech: new AI models, space exploration...',
                  body: 'Welcome to your weekly tech news! \n\nThis edition covers the latest breakthroughs in AI, including new large language models from Google and OpenAI. We also delve into the recent successful launch of the Europa Clipper mission and upcoming space tourism ventures. Read more about the implications of quantum computing for cybersecurity and the rise of sustainable tech solutions. \n\nSubscribe for more!' },
            ];
        },
        sendMail: async (accessToken, userId, mailContent) => {
            console.log(`Google API: Sending mail for user ${userId} with token ${accessToken}`, mailContent);
            await new Promise(resolve => setTimeout(resolve, 500));
            return { status: 'sent', messageId: `g_sent_${Date.now()}` };
        }
    },
    microsoft: {
        fetchInbox: async (accessToken, userId) => {
            console.log(`Microsoft API: Fetching inbox for user ${userId} with token ${accessToken}`);
            // Simulate API call to Microsoft Graph API
            await new Promise(resolve => setTimeout(resolve, 600)); // Simulate network delay
            return [
                { id: `m_mail_1_${Date.now()}`, from: 'bob@company.com', to: 'user@saas.com', subject: 'Meeting Confirmation', snippet: 'Confirming our meeting for tomorrow at 10 AM. Please find the agenda attached.',
                  body: 'Hi user, \n\nThis email is to confirm our meeting scheduled for tomorrow, June 22nd, at 10:00 AM in Conference Room 3. The agenda includes reviewing the quarterly sales figures and planning for the upcoming marketing campaign. Please come prepared to discuss your team\'s contributions. \n\nBest regards, \nBob' },
                { id: `m_mail_2_${Date.now()}`, from: 'updates@msoffice.com', to: 'user@saas.com', subject: 'Office 365 Updates', snippet: 'New features rolled out for Teams and Outlook this month.',
                  body: 'Dear Valued User, \n\nWe are excited to announce new updates to Microsoft 365! This month, we\'re rolling out enhanced collaboration features in Microsoft Teams, including improved video conferencing and custom backgrounds. Outlook users will benefit from a redesigned interface and smarter junk mail filtering. These updates aim to boost your productivity and streamline your workflow. \n\nThank you, \nMicrosoft 365 Team' },
            ];
        },
        sendMail: async (accessToken, userId, mailContent) => {
            console.log(`Microsoft API: Sending mail for user ${userId} with token ${accessToken}`, mailContent);
            await new Promise(resolve => setTimeout(resolve, 500));
            return { status: 'sent', messageId: `m_sent_${Date.now()}` };
        }
    }
};

// Placeholder for a simple message queue (in-memory for demo)
// In a real app, this would be Redis Streams, Kafka, or GCP Pub/Sub
const messageQueue = {
    publish: (eventName, payload) => {
        console.log(`MessageQueue: Published event "${eventName}" with payload:`, payload);
        // In a real app, this would send to a persistent queue
    },
    // No consume logic here, as it's handled by other services
};

// PostgreSQL setup
const pool = new Pool({
    user: 'your_user',
    host: 'localhost', // Or your PostgreSQL host
    database: 'saas_mail_db',
    password: 'your_password',
    port: 5432,
});

// Mock user storage (replace with actual PostgreSQL calls)
const usersDb = new Map(); // Stores { userId: { email, passwordHash, oauthTokens: { google: { access, refresh, expiry }, ... } } }

const app = express();
const PORT = 3000;
const JWT_SECRET = 'e681bda1351b31126bdccbfdad0ac6ea887d8276bf9fd86a542e0326c718e24c'; // Use a strong, environment variable in production

// Middleware
app.use(cors()); // Allow cross-origin requests from your frontend
app.use(bodyParser.json()); // Parse JSON request bodies

// Simple middleware to verify JWT
const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(' ')[1]; // "Bearer TOKEN"

        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) {
                return res.status(403).json({ message: 'Invalid or expired token.' });
            }
            req.user = user; // Attach user payload from JWT to request
            next();
        });
    } else {
        res.status(401).json({ message: 'Authorization token not provided.' });
    }
};

// --- User Authentication & Session Management Endpoints (Flows 1-7) ---

// Signup endpoint (Flows 1-5: User (Browser) -> API Gateway -> User Management Service -> Auth0/Firebase -> PostgreSQL)
app.post('/api/auth/signup', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
    }

    try {
        // 3. User Management Service interacts with Auth0/Firebase
        const externalUser = await authClient.signup(email, password);

        // 5. Store user profile in PostgreSQL (simplified for demo)
        const userId = externalUser.id;
        usersDb.set(userId, {
            email: externalUser.email,
            passwordHash: 'hashed_password_placeholder', // In reality, never store plain password
            oauthTokens: {},
            // In a real app, insert into PostgreSQL:
            // await pool.query('INSERT INTO users (id, email, ...) VALUES ($1, $2, ...)', [userId, email]);
        });
        console.log(`User ${email} registered with ID: ${userId}`);

        // 6. Issue JWT (User Management Service -> API Gateway -> Frontend)
        const token = jwt.sign({ id: userId, email: externalUser.email }, JWT_SECRET, { expiresIn: '1h' });
        res.status(201).json({ message: 'User registered successfully!', user: { id: userId, email: externalUser.email }, token });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ message: `Signup failed: ${error.message}` });
    }
});

// Login endpoint (Flows 1-7: User (Browser) -> API Gateway -> User Management Service -> Auth0/Firebase -> JWT -> Frontend)
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
    }

    try {
        // 3. User Management Service interacts with Auth0/Firebase for credential validation
        const externalUser = await authClient.login(email, password);

        // 5. Retrieve user profile from PostgreSQL (simplified for demo)
        const userInDb = usersDb.get(externalUser.id);
        if (!userInDb) {
            return res.status(404).json({ message: 'User not found.' });
        }

        // 6. Issue JWT (User Management Service -> API Gateway -> Frontend)
        const token = jwt.sign({ id: externalUser.id, email: externalUser.email }, JWT_SECRET, { expiresIn: '1h' });
        res.status(200).json({ message: 'Login successful!', user: { id: externalUser.id, email: externalUser.email }, token });
    } catch (error) {
        console.error('Login error:', error);
        res.status(401).json({ message: `Authentication failed: ${error.message}` });
    }
});

// OAuth connection initiation (Simulates redirect to Google/Microsoft consent screen)
// This endpoint would typically initiate the redirect from your backend
app.get('/api/auth/:provider/connect', authenticateJWT, (req, res) => {
    const { provider } = req.params;
    const userId = req.user.id;
    console.log(`User ${userId} wants to connect with ${provider}`);

    // In a real application, you'd construct the OAuth URL and redirect the user's browser.
    // The redirect URI (callback) would point back to your server's /auth/:provider/callback endpoint.
    const oauthUrl = authClient.initiateOAuth(provider);
    // For demo purposes, we'll immediately send a success response or simulate a direct callback.
    // In a real flow, the browser would be redirected to oauthUrl.
    // This is NOT the actual flow, but a simplification for this code demo.
    res.redirect(`http://localhost:3000/api/auth/${provider}/callback?code=mock_auth_code_for_${provider}&state=${userId}`);
});


// OAuth callback endpoint (Handles redirect from Google/Microsoft after user consent)
// (Part of Flow 5 from auth setup in data_flow_diagram's explanation section, where 'User Profile/JWT' goes to I)
app.get('/api/auth/:provider/callback', async (req, res) => {
    const { provider } = req.params;
    const { code, state: userId } = req.query; // 'state' should be used to protect against CSRF attacks
    console.log(`Received OAuth callback for ${provider} with code: ${code} and userId: ${userId}`);

    if (!code || !userId) {
        return res.status(400).send('OAuth callback missing code or state.');
    }

    try {
        // Exchange authorization code for access and refresh tokens
        const tokens = await authClient.exchangeCodeForTokens(provider, code);

        // Store encrypted tokens in PostgreSQL (User Management Service's responsibility)
        const user = usersDb.get(userId);
        if (user) {
            user.oauthTokens[provider] = {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresAt: Date.now() + tokens.expires_in * 1000,
                // In a real app, encrypt tokens before storing in DB
                // await pool.query('UPDATE users SET oauth_tokens = $1 WHERE id = $2', [JSON.stringify(user.oauthTokens), userId]);
            };
            usersDb.set(userId, user); // Update mock DB
            console.log(`User ${userId} successfully connected ${provider}. Tokens stored.`);
            // Redirect back to frontend, perhaps to the inbox page
            res.redirect(`http://localhost:3001/?message=Successfully connected ${provider} account`);
        } else {
            console.error(`User with ID ${userId} not found during OAuth callback.`);
            res.status(404).send('User not found.');
        }
    } catch (error) {
        console.error('OAuth callback error:', error);
        res.status(500).send(`Failed to connect ${provider} account: ${error.message}`);
    }
});


// Middleware to ensure user has connected at least one email service
const ensureEmailServiceConnected = (req, res, next) => {
    const user = usersDb.get(req.user.id);
    if (!user || Object.keys(user.oauthTokens).length === 0) {
        return res.status(400).json({ message: 'No email service connected. Please connect your Gmail or O365 account.' });
    }
    req.user.oauthTokens = user.oauthTokens; // Attach tokens to request for downstream services
    next();
};

// --- Email Inbox Synchronization Endpoints (Flows 8-20) ---

// Fetch emails endpoint (Flows 8-20: User (Browser) -> API Gateway -> Email Sync & Proxy Service -> PostgreSQL -> Gmail/MS Graph -> PostgreSQL/Redis/MQ -> Frontend)
app.get('/api/emails/inbox', authenticateJWT, ensureEmailServiceConnected, async (req, res) => {
    const userId = req.user.id;
    const userOAuthTokens = req.user.oauthTokens;
    let allEmails = [];

    console.log(`Fetching inbox for user ${userId}`);

    try {
        // Iterate through connected email services
        for (const provider in userOAuthTokens) {
            const tokenInfo = userOAuthTokens[provider];

            // 10-11. Retrieve OAuth Token from PostgreSQL (already attached to req.user by middleware)
            let currentAccessToken = tokenInfo.accessToken;

            // Check if access token is expired, if so, refresh it
            if (Date.now() > tokenInfo.expiresAt) {
                console.log(`Access token for ${provider} expired. Refreshing...`);
                const newTokens = await authClient.refreshAccessToken(provider, tokenInfo.refreshToken);
                currentAccessToken = newTokens.access_token;
                // Update stored token in DB (User Management Service's responsibility to persist)
                userOAuthTokens[provider].accessToken = currentAccessToken;
                userOAuthTokens[provider].expiresAt = Date.now() + newTokens.expires_in * 1000;
                // Update mock DB
                const user = usersDb.get(userId);
                if (user) {
                    user.oauthTokens[provider] = userOAuthTokens[provider];
                    usersDb.set(userId, user);
                }
            }

            // 12-14. Make authenticated calls to Google Workspace/Gmail API or Microsoft Graph API
            if (emailApiClients[provider]) {
                const emailsFromProvider = await emailApiClients[provider].fetchInbox(currentAccessToken, userId);
                allEmails = allEmails.concat(emailsFromProvider.map(email => ({ ...email, provider }))); // Add provider info
            }
        }

        // 15. Normalize & Store Metadata in PostgreSQL (simplified for demo)
        // In a real app, this would involve detailed parsing and DB inserts/updates.
        console.log(`Stored/Updated email metadata for user ${userId} in PostgreSQL.`);

        // 16. Publish "New Email" Event to Message Queue (simplified)
        messageQueue.publish('new_emails_fetched', { userId, count: allEmails.length });

        // 17. Cache Email Headers in Redis (simplified for demo)
        // redis.set(`user:${userId}:email_headers`, JSON.stringify(allEmails.slice(0, 50)), 'EX', 3600);
        console.log(`Cached email headers for user ${userId} in Redis.`);

        // 18-20. Return Mail Data (from DB/Cache) to UI
        res.status(200).json({ emails: allEmails });

    } catch (error) {
        console.error('Error fetching emails:', error);
        res.status(500).json({ message: `Failed to fetch emails: ${error.message}` });
    }
});


// --- LLM Features Endpoints ---

// Endpoint for email summarization
app.post('/api/emails/summarize', authenticateJWT, async (req, res) => {
    const { emailId, emailBody } = req.body;
    if (!emailId || !emailBody) {
        return res.status(400).json({ message: 'Email ID and body are required for summarization.' });
    }

    try {
        let chatHistory = [];
        const prompt = `Summarize the following email in a concise paragraph, focusing on the main points:\n\n${emailBody}`;
        chatHistory.push({ role: "user", parts: [{ text: prompt }] });

        const payload = { contents: chatHistory };
        const apiKey = "AIzaSyBeKc1tpI5q6wv5iIDYfmLS_yRbKOCO-iA"; // Canvas will inject API key for gemini-2.0-flash
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
            const summary = result.candidates[0].content.parts[0].text;
            res.status(200).json({ emailId, summary });
        } else {
            console.error('Gemini API response structure unexpected:', result);
            res.status(500).json({ message: 'Failed to get summary from AI: Unexpected response format.' });
        }
    } catch (error) {
        console.error('Error calling Gemini API for summarization:', error);
        res.status(500).json({ message: `Failed to summarize email using AI: ${error.message}` });
    }
});

// Endpoint for email classification
app.post('/api/emails/classify', authenticateJWT, async (req, res) => {
    const { emailId, emailBody } = req.body;
    if (!emailId || !emailBody) {
        return res.status(400).json({ message: 'Email ID and body are required for classification.' });
    }

    try {
        let chatHistory = [];
        const prompt = `Classify the following email into these categories: "content_risk" (High, Medium, Low, None), "action_required" (Yes, No, Information Only), "financial_impact" (High, Medium, Low, None), "schedule_impact" (High, Medium, Low, None). Provide the response as a JSON object.\n\nEmail:\n"${emailBody}"`;
        chatHistory.push({ role: "user", parts: [{ text: prompt }] });

        const payload = {
            contents: chatHistory,
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        "contentRisk": { "type": "STRING", "enum": ["High", "Medium", "Low", "None"] },
                        "actionRequired": { "type": "STRING", "enum": ["Yes", "No", "Information Only"] },
                        "financialImpact": { "type": "STRING", "enum": ["High", "Medium", "Low", "None"] },
                        "scheduleImpact": { "type": "STRING", "enum": ["High", "Medium", "Low", "None"] }
                    }
                }
            }
        };
        const apiKey = "AIzaSyBeKc1tpI5q6wv5iIDYfmLS_yRbKOCO-iA"; // Canvas will inject API key for gemini-2.0-flash
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
            const jsonString = result.candidates[0].content.parts[0].text;
            const classification = JSON.parse(jsonString); // Parse the JSON string
            res.status(200).json({ emailId, classification });
        } else {
            console.error('Gemini API response structure unexpected for classification:', result);
            res.status(500).json({ message: 'Failed to get classification from AI: Unexpected response format.' });
        }
    } catch (error) {
        console.error('Error calling Gemini API for classification:', error);
        res.status(500).json({ message: `Failed to classify email using AI: ${error.message}` });
    }
});


// Start the server
app.listen(PORT, () => {
    console.log(`API Gateway (Backend) running on http://localhost:${PORT}`);
    console.log('Ensure your frontend (e.g., React Dev Server) is running on http://localhost:3001');
    console.log('For OAuth callbacks, you need to configure redirect URIs in Google Cloud Console and Azure AD portal.');
    console.log('Mock email bodies added for LLM features. For real use, fetch full email content.');
});
