const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

console.log('🔧 Checking and fixing LMAA database connection...');

try {
  // Change to the shared directory where drizzle config is located
  const sharedDir = path.join(__dirname, 'shared');
  process.chdir(sharedDir);
  
  console.log('📁 Working directory:', process.cwd());
  
  // Check if DATABASE_URL is set
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is not set!');
    console.log('💡 Please check your .env file and ensure DATABASE_URL is configured.');
    process.exit(1);
  }
  
  console.log('✅ DATABASE_URL is configured:', process.env.DATABASE_URL.substring(0, 20) + '...');
  
  // Run database migrations
  console.log('🏃 Running database migrations...');
  execSync('npx drizzle-kit push', { stdio: 'inherit' });
  
  console.log('✅ Database setup completed successfully!');
  console.log('🎯 The email service should now work properly.');
  
} catch (error) {
  console.error('❌ Database setup failed:', error.message);
  console.log('\n💡 Troubleshooting:');
  console.log('1. Make sure PostgreSQL is running');
  console.log('2. Check your DATABASE_URL in .env file');
  console.log('3. Ensure database exists and is accessible');
  console.log('4. Make sure you have the correct database credentials');
  process.exit(1);
}
