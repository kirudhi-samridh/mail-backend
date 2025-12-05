import { getDb, emailAccounts } from './shared/db/connection';
import { eq } from 'drizzle-orm';

async function clearGmailConnections() {
    try {
        console.log('🧹 Clearing all Gmail connections...');
        const db = getDb();
        
        // Simple approach: delete all Google email accounts
        const result = await db.delete(emailAccounts).where(eq(emailAccounts.provider, 'google'));
        
        console.log('✅ All Gmail connections cleared successfully!');
        console.log('💡 The user will need to reconnect their Gmail account.');
        console.log('');
        console.log('Next steps:');
        console.log('1. Go to the frontend application');
        console.log('2. Log out and log back in');
        console.log('3. Connect your Gmail account again');
        console.log('4. This will generate a new, valid refresh token');
        
    } catch (error) {
        console.error('❌ Error clearing Gmail connections:', error.message);
        console.error('Full error:', error);
    }
}

clearGmailConnections();
