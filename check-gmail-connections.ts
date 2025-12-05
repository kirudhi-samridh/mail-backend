import { getDb } from './shared/db/connection';

async function checkUserGmailConnection() {
    try {
        console.log('🔍 Checking user Gmail connections...');
        const db = getDb();
        
        // Get all users with their email accounts
        const usersWithAccounts = await db.query.users.findMany({
            with: {
                emailAccounts: true
            }
        });
        
        console.log(`Found ${usersWithAccounts.length} users:`);
        
        usersWithAccounts.forEach(user => {
            console.log(`\n👤 User: ${user.email} (ID: ${user.id})`);
            console.log(`   Email accounts: ${user.emailAccounts.length}`);
            
            user.emailAccounts.forEach(account => {
                console.log(`   📧 Provider: ${account.provider}`);
                console.log(`   🔑 Has refresh token: ${!!account.refreshToken}`);
                console.log(`   ⏰ Token expires: ${account.tokenExpiresAt}`);
                console.log(`   📅 Created: ${account.createdAt}`);
            });
        });
        
        // Check if there are any Google accounts specifically
        const googleAccounts = await db.query.emailAccounts.findMany({
            where: {
                provider: 'google'
            }
        });
        
        console.log(`\n🔍 Found ${googleAccounts.length} Google accounts total`);
        
        if (googleAccounts.length === 0) {
            console.log('❌ No Google accounts found! This is likely the cause of the 500 error.');
            console.log('💡 The user needs to connect their Gmail account first.');
        } else {
            console.log('✅ Google accounts found. Checking token validity...');
            
            googleAccounts.forEach(account => {
                const isExpired = account.tokenExpiresAt && account.tokenExpiresAt < new Date();
                console.log(`   Account ${account.id}: ${isExpired ? '❌ EXPIRED' : '✅ Valid'}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Error checking Gmail connections:', error.message);
        console.error('Full error:', error);
    }
}

checkUserGmailConnection();
