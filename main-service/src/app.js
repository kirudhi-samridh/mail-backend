// --- Imports ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { google } = require('googleapis');

// --- Basic Setup ---
const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;

// --- Database Connection ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// --- Google OAuth2 Client Setup ---
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'postmessage' 
);

// --- Middleware ---
app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(bodyParser.json());

const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) {
                return res.status(403).json({ message: 'Invalid or expired token.' });
            }
            req.user = user;
            next();
        });
    } else {
        res.status(401).json({ message: 'Authorization token not provided.' });
    }
};

// --- Helper Function to get an authenticated Gmail client ---
async function getGmailClient(saasUserId) {
    const userResult = await pool.query('SELECT google_refresh_token FROM users WHERE id = $1', [saasUserId]);
    const refreshToken = userResult.rows[0]?.google_refresh_token;

    if (!refreshToken) {
        throw new Error('Google account not connected or refresh token missing.');
    }

    const client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        'postmessage'
    );
    client.setCredentials({ refresh_token: refreshToken });
    return google.gmail({ version: 'v1', auth: client });
}


// --- User Authentication Endpoints ---

// POST /api/auth/signup
app.post('/api/auth/signup', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
    }
    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = await pool.query(
            'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
            [email, passwordHash]
        );
        const user = newUser.rows[0];
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '8h' });
        res.status(201).json({ user, token });
    } catch (error) {
        console.error("Signup error:", error);
        res.status(500).json({ message: 'User registration failed. The email may already be in use.' });
    }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '8h' });
        res.status(200).json({ user: {id: user.id, email: user.email }, token });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: 'Login failed due to a server error.' });
    }
});

// --- Google OAuth & Gmail API Endpoints ---

// POST /api/auth/google/callback
app.post('/api/auth/google/callback', authenticateJWT, async (req, res) => {
    const { code } = req.body;
    const saasUserId = req.user.id;
    try {
        const { tokens } = await oauth2Client.getToken(code);
        const { refresh_token } = tokens;
        if (!refresh_token) {
             console.warn("Refresh token not received. User may have already consented.");
        }
        await pool.query(
            'UPDATE users SET google_refresh_token = $1 WHERE id = $2',
            [refresh_token, saasUserId]
        );
        console.log(`Successfully stored Google refresh token for user ${saasUserId}`);
        res.status(200).json({ message: 'Google account connected successfully.' });
    } catch (error) {
        console.error('Error exchanging Google auth code for tokens:', error.message);
        res.status(500).json({ message: 'Failed to connect Google account.' });
    }
});

// GET /api/emails/inbox
app.get('/api/emails/inbox', authenticateJWT, async (req, res) => {
    try {
        const gmail = await getGmailClient(req.user.id);
        const response = await gmail.users.messages.list({
            userId: 'me',
            labelIds: ['INBOX'],
            maxResults: 15,
        });
        const messages = response.data.messages || [];
        
        // Optional: Fetch details for each message to get subject, sender, snippet etc.
        const detailedMessages = await Promise.all(messages.map(async (message) => {
            const msg = await gmail.users.messages.get({ userId: 'me', id: message.id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
            const headers = msg.data.payload.headers;
            const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
            const from = headers.find(h => h.name === 'From')?.value || 'Unknown Sender';
            const date = headers.find(h => h.name === 'Date')?.value || '';
            
            return { id: msg.data.id, snippet: msg.data.snippet, subject, from, date };
        }));

        res.status(200).json({ messages: detailedMessages });
    } catch (error) {
        console.error('Error fetching Gmail inbox:', error.message);
        res.status(500).json({ message: 'Failed to fetch emails.' });
    }
});

// GET /api/emails/:emailId
app.get('/api/emails/:emailId', authenticateJWT, async (req, res) => {
    const { emailId } = req.params;
    try {
        const gmail = await getGmailClient(req.user.id);
        const msg = await gmail.users.messages.get({ userId: 'me', id: emailId, format: 'full' });
        
        let body = '';
        const payload = msg.data.payload;

        // Recursive function to find the right body part
        function findPart(parts, mimeType) {
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

        let encodedBody = null;
        if (payload.parts) {
            // Prefer HTML over plain text
            encodedBody = findPart(payload.parts, 'text/html') || findPart(payload.parts, 'text/plain');
        } else if (payload.body && payload.body.data) {
            encodedBody = payload.body.data;
        }
        
        if (encodedBody) {
            body = Buffer.from(encodedBody, 'base64').toString('utf-8');
        }

        const headers = payload.headers;
        const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || 'No Subject';
        const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender';
        const date = headers.find(h => h.name.toLowerCase() === 'date')?.value || '';
        
        res.status(200).json({
            id: msg.data.id,
            snippet: msg.data.snippet,
            subject,
            from,
            date,
            body
        });

    } catch (error) {
        console.error(`Error fetching email ${emailId}:`, error.message);
        res.status(500).json({ message: `Failed to fetch email content.` });
    }
});

// POST /api/emails/:emailId/summarize
app.post('/api/emails/:emailId/summarize', authenticateJWT, async (req, res) => {
    const { emailId } = req.params;
    try {
        const gmail = await getGmailClient(req.user.id);
        const msg = await gmail.users.messages.get({ userId: 'me', id: emailId, format: 'full' });
        
        let body = '';
        const payload = msg.data.payload;
        if (payload.parts) {
            const part = payload.parts.find(p => p.mimeType === 'text/plain') || payload.parts.find(p => p.mimeType === 'text/html');
            if (part && part.body.data) {
                body = Buffer.from(part.body.data, 'base64').toString('utf-8');
            }
        } else if (payload.body && payload.body.data) {
            body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
        }

        if (!body) {
            return res.status(400).json({ message: "Could not find text content in this email to summarize." });
        }
        
        // Strip HTML tags for a cleaner prompt
        const cleanBody = body.replace(/<[^>]*>?/gm, '');
        
        const prompt = `Please provide a concise, one-paragraph summary of the following email content:\n\n---\n${cleanBody}`;
        const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
        const geminiPayload = { contents: chatHistory };
        const apiKey = process.env.GEMINI_API_KEY;
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
        });
        
        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            throw new Error(`Gemini API request failed: ${errorText}`);
        }

        const result = await geminiResponse.json();
        if (result.candidates && result.candidates.length > 0) {
            const summary = result.candidates[0].content.parts[0].text;
            res.status(200).json({ summary });
        } else {
            throw new Error('Unexpected response format from Gemini API.');
        }

    } catch (error) {
        console.error(`Error summarizing email ${emailId}:`, error.message);
        res.status(500).json({ message: `Failed to summarize email.` });
    }
});


// --- Server Start ---
app.listen(PORT, () => {
  console.log(`✅ Backend server running on http://localhost:${PORT}`);
});
