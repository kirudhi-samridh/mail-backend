import { google } from 'googleapis';

async function testGoogleOAuthConfig() {
    try {
        console.log('🔍 Testing Google OAuth configuration...');
        
        // Check environment variables
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        
        console.log('✅ GOOGLE_CLIENT_ID:', clientId ? 'Set' : 'Missing');
        console.log('✅ GOOGLE_CLIENT_SECRET:', clientSecret ? 'Set' : 'Missing');
        
        if (!clientId || !clientSecret) {
            console.error('❌ Missing Google OAuth credentials!');
            return;
        }
        
        // Create OAuth2 client
        const oauth2Client = new google.auth.OAuth2(
            clientId,
            clientSecret,
            'http://localhost:3001/api/auth/google/callback'
        );
        
        console.log('✅ OAuth2 client created successfully');
        console.log('✅ Redirect URI:', 'http://localhost:3001/api/auth/google/callback');
        
        // Test Gmail API access
        console.log('🔍 Testing Gmail API access...');
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        
        console.log('✅ Gmail API client created successfully');
        console.log('💡 Note: This test only checks configuration, not actual API calls');
        
    } catch (error) {
        console.error('❌ Error testing Google OAuth config:', error.message);
    }
}

testGoogleOAuthConfig();
