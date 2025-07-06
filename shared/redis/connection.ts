import Redis from 'ioredis';
import * as dotenv from 'dotenv';

dotenv.config();

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  keepAlive: 30000,
  family: 4,
  connectTimeout: 60000,    // Increased from 10s to 60s for WSL
  commandTimeout: 120000,   // Increased from 30s to 120s for WSL
  enableOfflineQueue: true,  // Fix for "Stream isn't writeable" error
};

let redisClient: Redis | null = null;

export function getRedisConnection(db: number = 0, keyPrefix?: string): Redis {
  const redis = new Redis({
    ...redisConfig,
    db,
    keyPrefix
  });

  // Add command debugging
  redis.on('connect', () => {
    console.log(`[REDIS_DEBUG] Connected to Redis (db: ${db}, prefix: ${keyPrefix || 'none'})`);
  });

  redis.on('error', (err) => {
    console.log(`[REDIS_DEBUG] Redis error (db: ${db}):`, err.message);
  });

  // Log slow commands
  const originalSendCommand = redis.sendCommand;
  redis.sendCommand = function(command) {
    const startTime = Date.now();
    const commandName = command.name;
    const args = command.args?.slice(0, 3).join(' ') || ''; // First 3 args only
    
    console.log(`[REDIS_DEBUG] Executing: ${commandName} ${args}`);
    
    const result = originalSendCommand.call(this, command);
    
    if (result && typeof result.then === 'function') {
      result.then(
        () => {
          const duration = Date.now() - startTime;
          if (duration > 5000) { // Log commands taking more than 5 seconds
            console.log(`[REDIS_DEBUG] SLOW COMMAND: ${commandName} took ${duration}ms`);
          }
        },
        (err) => {
          const duration = Date.now() - startTime;
          console.log(`[REDIS_DEBUG] FAILED COMMAND: ${commandName} failed after ${duration}ms - ${err.message}`);
        }
      );
    }
    
    return result;
  };

  return redis;
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = getRedisConnection(0);
  }
  return redisClient;
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

export async function closeRedisConnections(): Promise<void> {
  if (redisClient) {
    redisClient.disconnect();
  }
} 