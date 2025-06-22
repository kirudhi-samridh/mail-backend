// In email-sync-proxy-service/src/routes/emailRoutes.js (or similar)
const express = require('express');
const { google } = require('googleapis');

const router = express.Router();

// These would also come from your .env file
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

router.get('/inbox', async (req, res) => {
    // This route MUST be protected. Assume middleware has verified the user's JWT
    // and attached their user ID to the request, e.g., req.user.id
    // const userId = req.user.id;

    try {
        // 1. Fetch the user's encrypted refresh token from your PostgreSQL database.
        // const { encrypted_token } = await db.query('SELECT google_refresh_token FROM users WHERE id = $1', [userId]);
        // const refreshToken = decrypt(encrypted_token);

        // For this example, let's pretend we have the token.
        // In a real app, you MUST fetch this from your DB.
        const refreshToken = 'THE_STORED_REFRESH_TOKEN_FROM_STEP_B';

        if (!refreshToken) {
            return res.status(401).json({ message: 'User has not connected their Google account.' });
        }

        // 2. Set up the OAuth2 client and refresh the access token
        const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
        oauth2Client.setCredentials({ refresh_token: refreshToken });

        // 3. Initialize the Gmail API client
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // 4. Call the Gmail API to list messages
        const response = await gmail.users.messages.list({
            userId: 'me',
            labelIds: ['INBOX'],
            maxResults: 10, // Fetch the 10 most recent messages
        });

        const messages = response.data.messages || [];

        res.status(200).json({ messages });

    } catch (error) {
        console.error('Error fetching Gmail inbox:', error.message);
        res.status(500).json({ message: 'Failed to fetch emails.' });
    }
});

module.exports = router;