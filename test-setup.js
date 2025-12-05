const { execSync } = require('child_process');
const Redis = require('ioredis');
const postgres = require('postgres');

async function testSetup() {
    console.log('🔧 Testing LMAA Backend Setup...\n');
    
    let allGood = true;
    const issues = [];

    // Test 1: Node.js version
    console.log('1️⃣ Testing Node.js...');
    try {
        const nodeVersion = process.version;
        console.log(`   ✅ Node.js version: ${nodeVersion}`);
    } catch (error) {
        console.log(`   ❌ Node.js test failed: ${error.message}`);
        issues.push('Node.js version check failed');
        allGood = false;
    }

    // Test 2: Redis connection
    console.log('\n2️⃣ Testing Redis connection...');
    try {
        const redis = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            retryDelayOnFailover: 100,
            maxRetriesPerRequest: 1,
            lazyConnect: true,
        });
        
        await redis.ping();
        console.log('   ✅ Redis connection successful');
        redis.disconnect();
    } catch (error) {
        console.log(`   ❌ Redis connection failed: ${error.message}`);
        issues.push('Redis is not running or accessible');
        allGood = false;
    }

    // Test 3: PostgreSQL connection
    console.log('\n3️⃣ Testing PostgreSQL connection...');
    try {
        const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/lmaa';
        const sql = postgres(dbUrl, { max: 1 });
        
        const result = await sql`SELECT version()`;
        console.log('   ✅ PostgreSQL connection successful');
        console.log(`   📊 Database version: ${result[0].version.split(' ')[0]} ${result[0].version.split(' ')[1]}`);
        await sql.end();
    } catch (error) {
        console.log(`   ❌ PostgreSQL connection failed: ${error.message}`);
        issues.push('PostgreSQL is not running or DATABASE_URL is incorrect');
        allGood = false;
    }

    // Test 4: Environment variables
    console.log('\n4️⃣ Checking environment variables...');
    const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET'];
    const missingVars = [];
    
    for (const envVar of requiredEnvVars) {
        if (process.env[envVar]) {
            console.log(`   ✅ ${envVar} is set`);
        } else {
            console.log(`   ⚠️  ${envVar} is not set`);
            missingVars.push(envVar);
        }
    }
    
    if (missingVars.length > 0) {
        issues.push(`Missing environment variables: ${missingVars.join(', ')}`);
    }

    // Test 5: Database schema
    console.log('\n5️⃣ Testing database schema...');
    try {
        const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/lmaa';
        const sql = postgres(dbUrl, { max: 1 });
        
        const tables = await sql`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'users'
        `;
        
        if (tables.length > 0) {
            console.log('   ✅ Database schema exists (users table found)');
        } else {
            console.log('   ⚠️  Database schema not found. Run: npm run setup');
            issues.push('Database schema needs to be initialized');
        }
        
        await sql.end();
    } catch (error) {
        console.log(`   ⚠️  Could not check database schema: ${error.message}`);
        issues.push('Database schema check failed');
    }

    // Results
    console.log('\n' + '='.repeat(50));
    
    if (allGood && issues.length === 0) {
        console.log('🎉 Setup Test Results: ALL GOOD!');
        console.log('✅ Your LMAA backend is ready to run');
        console.log('\n🚀 Next steps:');
        console.log('   1. Run: npm run dev');
        console.log('   2. Open: http://localhost:3000');
    } else {
        console.log('⚠️  Setup Test Results: Issues Found');
        console.log('\n❌ Issues to fix:');
        issues.forEach((issue, index) => {
            console.log(`   ${index + 1}. ${issue}`);
        });
        console.log('\n💡 Solutions:');
        console.log('   📖 Check: QUICK_START.md for setup instructions');
        console.log('   🔧 Run: npm run setup (for database)');
        console.log('   ⚙️  Create: .env file with required variables');
    }
    
    console.log('\n' + '='.repeat(50));
}

// Load environment variables
require('dotenv').config();

// Run the test
testSetup().catch(error => {
    console.error('❌ Setup test failed:', error.message);
    process.exit(1);
}); 