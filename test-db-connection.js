const { getDb } = require('./shared/db/connection.ts');

async function testDatabaseConnection() {
    try {
        console.log('Testing database connection...');
        const db = getDb();
        
        // Try a simple query
        const result = await db.query.users.findFirst();
        console.log('Database connection successful!');
        console.log('Sample user data:', result);
        
    } catch (error) {
        console.error('Database connection failed:', error.message);
        console.error('Full error:', error);
    }
}

testDatabaseConnection();
