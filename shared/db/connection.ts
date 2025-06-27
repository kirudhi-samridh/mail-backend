import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Database connection factory
export function createDbConnection(databaseUrl?: string) {
  const pool = new Pool({
    connectionString: databaseUrl || process.env.DATABASE_URL,
  });

  return drizzle(pool, { schema });
}

// Default database connection (uses DATABASE_URL from env)
let dbConnection: ReturnType<typeof createDbConnection> | null = null;

export function getDb() {
  if (!dbConnection) {
    dbConnection = createDbConnection();
  }
  return dbConnection;
}

// Export schema for easy access
export * from './schema'; 