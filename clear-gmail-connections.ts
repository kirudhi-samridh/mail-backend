import { getDb } from './shared/db/connection';

async function clearInvalidGmailConnections() {
    try {
        console.log('🧹 Clearing invalid Gmail connections...');
        const db = getDb();
        
        // Find all Google accounts
        const googleAccounts = await db.query.emailAccounts.findMany({
            where: {
                provider: 'google'
            }
        });
        
        console.log(`Found ${googleAccounts.length} Google accounts`);
        
        if (googleAccounts.length === 0) {
            console.log('No Google accounts found to clear.');
            return;
        }
        
        // Delete all Google accounts (this will force user to reconnect)
        for (const account of googleAccounts) {
            console.log(`Deleting Google account for user: ${account.userId}`);
            await db.delete(db.emailAccounts).where(db.emailAccounts.id.equals(account.id));
        }
        
        console.log('✅ All Google accounts cleared successfully!');
        console.log('💡 The user will need to reconnect their Gmail account.');
        
    } catch (error) {
        console.error('❌ Error clearing Gmail connections:', error.message);
    }
}

clearInvalidGmailConnections();
