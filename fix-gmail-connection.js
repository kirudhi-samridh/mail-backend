const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Use tsx to run TypeScript files
const { execSync } = require('child_process');

async function fixGmailConnection() {
    try {
        console.log('🔧 Fixing Gmail connection issue...');
        console.log('The error shows: "invalid_grant" - this means the refresh token is expired or invalid.');
        console.log('');
        console.log('💡 Solution: The user needs to reconnect their Gmail account.');
        console.log('');
        console.log('Steps to fix:');
        console.log('1. Go to the frontend application');
        console.log('2. Log out and log back in');
        console.log('3. Go through the Gmail connection process again');
        console.log('4. This will generate a new refresh token');
        console.log('');
        console.log('Alternative: Clear the existing Gmail connection from the database');
        
        // Check current Gmail connections
        const scriptPath = path.join(__dirname, 'check-gmail-connections.ts');
        console.log('\n🔍 Checking current Gmail connections...');
        execSync(`npx tsx ${scriptPath}`, { stdio: 'inherit' });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

fixGmailConnection();
