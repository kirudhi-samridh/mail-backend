// In user-management-service/src/routes/authRoutes.js (or similar)
const express = require('express');
const { google } = require('googleapis');

const router = express.Router();

// IMPORTANT: Store these in .env files, not in code!
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3001/api/auth/google/callback';

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

router.post('/google/callback', async (req, res) => {
  const { code } = req.body;

  try {
    // Exchange the authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    const { access_token, refresh_token, expiry_date } = tokens;

    console.log('Received tokens:', tokens);

    // **SECURITY CRITICAL STEP**
    // 1. Get the user's Google profile to get their unique Google ID and email.
    oauth2Client.setCredentials(tokens);
    const people = google.people({ version: 'v1', auth: oauth2Client });
    const profile = await people.people.get({
        resourceName: 'people/me',
        personFields: 'emailAddresses,names',
    });
    const googleEmail = profile.data.emailAddresses[0].value;
    
    // 2. Find the user in your database via the JWT from your own app's login.
    // const userId = req.user.id; // (Assuming you have middleware that adds the user to the request)
    
    // 3. Encrypt the refresh_token before saving it.
    // const encryptedRefreshToken = encrypt(refresh_token); // Use a strong encryption library like 'crypto'
    
    // 4. Save the encrypted refresh_token and other details to your PostgreSQL DB
    // associated with your internal user ID.
    // await db.query('UPDATE users SET google_refresh_token = $1 WHERE id = $2', [encryptedRefreshToken, userId]);
    
    // For this example, we'll just log it. DO NOT do this in production.
    console.log(`Tokens for ${googleEmail} would be stored securely now.`);
    if (refresh_token) {
      console.log('Refresh token received. Store it!');
    }


    res.status(200).json({ message: 'Authentication successful. Tokens stored.' });
  } catch (error) {
    console.error('Error exchanging code for tokens:', error.message);
    res.status(500).json({ message: 'Authentication failed.' });
  }
});

module.exports = router;