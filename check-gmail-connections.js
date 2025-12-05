const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Use tsx to run TypeScript files
const { execSync } = require('child_process');

async function checkUserGmailConnection() {
    try {
        console.log('🔍 Checking user Gmail connections...');
        
        // Run a TypeScript file using tsx
        const scriptPath = path.join(__dirname, 'check-gmail-connections.ts');
        
        console.log('Running Gmail connection check...');
        execSync(`npx tsx ${scriptPath}`, { stdio: 'inherit' });
        
    } catch (error) {
        console.error('❌ Error checking Gmail connections:', error.message);
    }
}

checkUserGmailConnection();
