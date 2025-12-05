import Redis from 'ioredis';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from the root .env file
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
};

let redisConnection: Redis;

export function getRedisConnection(): Redis {
  if (!redisConnection) {
    redisConnection = new Redis(redisConfig);

    redisConnection.on('connect', () => {
      console.log('[REDIS] Connection established successfully.');
    });

    redisConnection.on('error', (err) => {
      console.error('[REDIS] Connection error:', err);
    });
  }
  return redisConnection;
}

export function getRedisClient(): Redis {
  return getRedisConnection();
}

export async function closeRedisConnections(): Promise<void> {
  if (redisConnection) {
    redisConnection.disconnect();
  }
}

export function getCacheClient(): Redis {
  return getRedisConnection(1, 'lmaa:cache:');
}

export function getSessionClient(): Redis {
  return getRedisConnection(2, 'lmaa:session:');
}

export function getQueueClient(): Redis {
  return getRedisConnection(3, 'lmaa:queue:');
}

export class CacheService {
  private client = getCacheClient();

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<boolean> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await this.client.setex(key, ttlSeconds, serialized);
      } else {
        await this.client.set(key, serialized);
      }
      return true;
    } catch {
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    try {
      await this.client.del(key);
      return true;
    } catch {
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await this.client.exists(key)) === 1;
    } catch {
      return false;
    }
  }

  async increment(key: string, value: number = 1): Promise<number> {
    try {
      return await this.client.incrby(key, value);
    } catch {
      return 0;
    }
  }

  async getByPattern(pattern: string): Promise<Record<string, any>> {
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length === 0) return {};

      const values = await this.client.mget(keys);
      const result: Record<string, any> = {};

      keys.forEach((key, index) => {
        if (values[index]) {
          try {
            result[key] = JSON.parse(values[index] as string);
          } catch {
            result[key] = values[index];
          }
        }
      });

      return result;
    } catch {
      return {};
    }
  }

  async deleteByPattern(pattern: string): Promise<number> {
    try {
      const keys = await this.client.keys(pattern);
      return keys.length > 0 ? await this.client.del(...keys) : 0;
    } catch {
      return 0;
    }
  }
}

export class RateLimitService {
  private client = getRedisClient();

  async checkRateLimit(
    key: string, 
    limit: number, 
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    try {
      const current = await this.client.incr(key);
      
      if (current === 1) {
        await this.client.expire(key, windowSeconds);
      }
      
      const ttl = await this.client.ttl(key);
      const resetTime = Date.now() + (ttl * 1000);
      
      return {
        allowed: current <= limit,
        remaining: Math.max(0, limit - current),
        resetTime
      };
    } catch {
      return { allowed: true, remaining: limit, resetTime: Date.now() + (windowSeconds * 1000) };
    }
  }
}

export const cacheService = new CacheService();
export const rateLimitService = new RateLimitService(); 