const { execSync } = require('child_process');
const path = require('path');

console.log('🔧 Setting up LMAA database...');

try {
  // Change to the shared directory where drizzle config is located
  const sharedDir = path.join(__dirname, 'shared');
  process.chdir(sharedDir);
  
  console.log('📁 Working directory:', process.cwd());
  
  // Run database migrations
  console.log('🏃 Running database migrations...');
  execSync('npx drizzle-kit push', { stdio: 'inherit' });
  
  console.log('✅ Database setup completed successfully!');
  console.log('🎯 You can now start the backend services.');
  
} catch (error) {
  console.error('❌ Database setup failed:', error.message);
  console.log('\n💡 Troubleshooting:');
  console.log('1. Make sure PostgreSQL is running');
  console.log('2. Check your DATABASE_URL in .env file');
  console.log('3. Ensure database exists and is accessible');
  process.exit(1);
} 