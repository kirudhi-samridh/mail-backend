/**
 * API Integration Framework
 * 
 * Comprehensive framework for integrating with external APIs that handles
 * authentication, rate limiting, error recovery, and data transformation.
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { EventEmitter } from 'events';
import { logger } from '../logging/logger';
import { getRedisConnection } from '../redis/connection';
import { Redis } from 'ioredis';

// =============================================
// Core Interfaces
// =============================================

export interface APIConfig {
  name: string;
  baseURL: string;
  authStrategy: AuthStrategy;
  rateLimits?: RateLimit[];
  retryPolicy?: RetryPolicy;
  timeout?: number;
  headers?: Record<string, string>;
  transformers?: DataTransformer[];
}

export interface AuthStrategy {
  type: 'oauth2' | 'api_key' | 'bearer' | 'basic';
  credentials: OAuth2Credentials | APIKeyCredentials | BearerCredentials | BasicCredentials;
  refreshEndpoint?: string;
  refreshThreshold?: number; // Minutes before expiry to refresh
}

export interface OAuth2Credentials {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes?: string[];
}

export interface APIKeyCredentials {
  key: string;
  headerName?: string;
  paramName?: string;
}

export interface BearerCredentials {
  token: string;
  expiresAt?: Date;
}

export interface BasicCredentials {
  username: string;
  password: string;
}

export interface RateLimit {
  name: string;
  requests: number;
  window: number; // in milliseconds
  type: 'sliding' | 'fixed';
}

export interface RetryPolicy {
  attempts: number;
  backoff: 'linear' | 'exponential' | 'fixed';
  baseDelay: number; // milliseconds
  maxDelay?: number;
  retryCondition?: (error: any) => boolean;
}

export interface DataTransformer {
  name: string;
  direction: 'request' | 'response' | 'both';
  transform: (data: any, context: TransformContext) => any;
}

export interface TransformContext {
  operation: string;
  clientName: string;
  metadata?: Record<string, any>;
}

export interface APIRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  endpoint: string;
  data?: any;
  params?: Record<string, any>;
  headers?: Record<string, string>;
  timeout?: number;
  metadata?: Record<string, any>;
}

export interface APIResponse<T = any> {
  data: T;
  status: number;
  headers: Record<string, string>;
  metadata: {
    duration: number;
    cached: boolean;
    retryCount: number;
    rateLimited: boolean;
  };
}

export interface BatchAPIRequest {
  requests: APIRequest[];
  concurrency?: number;
  failFast?: boolean;
}

export interface BatchAPIResponse<T = any> {
  responses: (APIResponse<T> | Error)[];
  summary: {
    successful: number;
    failed: number;
    duration: number;
  };
}

export interface APIMetrics {
  totalRequests: number;
  successRate: number;
  avgResponseTime: number;
  rateLimitHits: number;
  errorCount: number;
  lastError?: Error;
}

// =============================================
// Rate Limiter
// =============================================

class RateLimiter {
  private redis: Redis;
  private keyPrefix = 'rate_limit:';

  constructor() {
    this.redis = getRedisConnection();
  }

  async checkLimit(limitName: string, rateLimit: RateLimit): Promise<boolean> {
    const key = `${this.keyPrefix}${limitName}`;
    
    if (rateLimit.type === 'sliding') {
      return this.checkSlidingWindow(key, rateLimit);
    } else {
      return this.checkFixedWindow(key, rateLimit);
    }
  }

  private async checkSlidingWindow(key: string, rateLimit: RateLimit): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - rateLimit.window;

    // Remove old entries
    await this.redis.zremrangebyscore(key, 0, windowStart);
    
    // Count current requests
    const currentCount = await this.redis.zcard(key);
    
    if (currentCount >= rateLimit.requests) {
      return false; // Rate limited
    }

    // Add current request
    await this.redis.zadd(key, now, `${now}-${Math.random()}`);
    await this.redis.expire(key, Math.ceil(rateLimit.window / 1000));
    
    return true;
  }

  private async checkFixedWindow(key: string, rateLimit: RateLimit): Promise<boolean> {
    const windowKey = `${key}:${Math.floor(Date.now() / rateLimit.window)}`;
    
    const currentCount = await this.redis.incr(windowKey);
    if (currentCount === 1) {
      await this.redis.expire(windowKey, Math.ceil(rateLimit.window / 1000));
    }
    
    return currentCount <= rateLimit.requests;
  }
}

// =============================================
// Circuit Breaker
// =============================================

class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private threshold: number = 5,
    private timeout: number = 60000 // 1 minute
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }
}

// =============================================
// API Client
// =============================================

export class APIClient extends EventEmitter {
  private axiosInstance: AxiosInstance;
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreaker;
  private metrics: APIMetrics;
  private redis: Redis;

  constructor(private config: APIConfig) {
    super();
    
    this.rateLimiter = new RateLimiter();
    this.circuitBreaker = new CircuitBreaker();
    this.redis = getRedisConnection();
    
    this.metrics = {
      totalRequests: 0,
      successRate: 0,
      avgResponseTime: 0,
      rateLimitHits: 0,
      errorCount: 0
    };

    this.axiosInstance = this.createAxiosInstance();
    this.setupInterceptors();
  }

  private createAxiosInstance(): AxiosInstance {
    return axios.create({
      baseURL: this.config.baseURL,
      timeout: this.config.timeout || 30000,
      headers: this.config.headers || {}
    });
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.axiosInstance.interceptors.request.use(
      async (config) => {
        // Check rate limits
        if (this.config.rateLimits) {
          for (const rateLimit of this.config.rateLimits) {
            const allowed = await this.rateLimiter.checkLimit(
              `${this.config.name}:${rateLimit.name}`,
              rateLimit
            );
            
            if (!allowed) {
              this.metrics.rateLimitHits++;
              throw new Error(`Rate limit exceeded for ${rateLimit.name}`);
            }
          }
        }

        // Add authentication
        await this.addAuthentication(config);
        
        // Apply request transformers
        if (this.config.transformers) {
          const requestTransformers = this.config.transformers.filter(
            t => t.direction === 'request' || t.direction === 'both'
          );
          
          for (const transformer of requestTransformers) {
            config.data = transformer.transform(config.data, {
              operation: 'request',
              clientName: this.config.name
            });
          }
        }

        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor
    this.axiosInstance.interceptors.response.use(
      (response) => {
        // Apply response transformers
        if (this.config.transformers) {
          const responseTransformers = this.config.transformers.filter(
            t => t.direction === 'response' || t.direction === 'both'
          );
          
          for (const transformer of responseTransformers) {
            response.data = transformer.transform(response.data, {
              operation: 'response',
              clientName: this.config.name
            });
          }
        }

        return response;
      },
      async (error) => {
        // Handle token refresh
        if (error.response?.status === 401 && this.config.authStrategy.type === 'oauth2') {
          try {
            await this.refreshToken();
            // Retry the original request
            return this.axiosInstance.request(error.config);
          } catch (refreshError) {
            logger.logError('Token refresh failed', refreshError as Error, {
              client: this.config.name
            });
          }
        }

        return Promise.reject(error);
      }
    );
  }

  private async addAuthentication(config: AxiosRequestConfig): Promise<void> {
    const auth = this.config.authStrategy;
    
    switch (auth.type) {
      case 'oauth2':
        const oauth2Creds = auth.credentials as OAuth2Credentials;
        if (oauth2Creds.accessToken) {
          config.headers!.Authorization = `Bearer ${oauth2Creds.accessToken}`;
        }
        break;
        
      case 'bearer':
        const bearerCreds = auth.credentials as BearerCredentials;
        config.headers!.Authorization = `Bearer ${bearerCreds.token}`;
        break;
        
      case 'api_key':
        const apiKeyCreds = auth.credentials as APIKeyCredentials;
        if (apiKeyCreds.headerName) {
          config.headers![apiKeyCreds.headerName] = apiKeyCreds.key;
        }
        if (apiKeyCreds.paramName) {
          config.params = config.params || {};
          config.params[apiKeyCreds.paramName] = apiKeyCreds.key;
        }
        break;
        
      case 'basic':
        const basicCreds = auth.credentials as BasicCredentials;
        const encoded = Buffer.from(`${basicCreds.username}:${basicCreds.password}`).toString('base64');
        config.headers!.Authorization = `Basic ${encoded}`;
        break;
    }
  }

  private async refreshToken(): Promise<void> {
    if (this.config.authStrategy.type !== 'oauth2') {
      throw new Error('Token refresh only supported for OAuth2');
    }

    const oauth2Creds = this.config.authStrategy.credentials as OAuth2Credentials;
    if (!oauth2Creds.refreshToken) {
      throw new Error('No refresh token available');
    }

    // Implement OAuth2 token refresh logic
    // This would typically involve calling the provider's token endpoint
    logger.logAuth('token_refresh', 'system', true, {
      client: this.config.name
    });
  }

  /**
   * Make a single API request
   */
  async makeRequest<T>(request: APIRequest): Promise<APIResponse<T>> {
    const startTime = Date.now();
    this.metrics.totalRequests++;

    try {
      const response = await this.circuitBreaker.execute(async () => {
        return await this.axiosInstance.request({
          method: request.method,
          url: request.endpoint,
          data: request.data,
          params: request.params,
          headers: request.headers,
          timeout: request.timeout
        });
      });

      const duration = Date.now() - startTime;
      
      // Update metrics
      this.updateMetrics(true, duration);

      // Log successful request
      logger.logExternalAPI(
        this.config.name,
        request.endpoint,
        request.method,
        response.status,
        duration,
        { requestId: request.metadata?.requestId }
      );

      return {
        data: response.data,
        status: response.status,
        headers: response.headers as Record<string, string>,
        metadata: {
          duration,
          cached: false,
          retryCount: 0,
          rateLimited: false
        }
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.updateMetrics(false, duration);
      
      // Apply retry policy if configured
      if (this.config.retryPolicy && this.shouldRetry(error)) {
        return this.retryRequest(request, 1);
      }

      logger.logExternalAPI(
        this.config.name,
        request.endpoint,
        request.method,
        error.response?.status || 0,
        duration,
        { 
          error: error.message,
          requestId: request.metadata?.requestId
        }
      );

      throw error;
    }
  }

  /**
   * Make multiple API requests in parallel
   */
  async makeBatchRequest<T>(batchRequest: BatchAPIRequest): Promise<BatchAPIResponse<T>> {
    const startTime = Date.now();
    const concurrency = batchRequest.concurrency || 5;
    const results: (APIResponse<T> | Error)[] = [];

    // Process requests in batches to respect concurrency limits
    const requestBatches = this.chunk(batchRequest.requests, concurrency);
    
    for (const batch of requestBatches) {
      const batchPromises = batch.map(async (request) => {
        try {
          return await this.makeRequest<T>(request);
        } catch (error) {
          if (batchRequest.failFast) {
            throw error;
          }
          return error as Error;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    const successful = results.filter(r => !(r instanceof Error)).length;
    const failed = results.length - successful;

    return {
      responses: results,
      summary: {
        successful,
        failed,
        duration: Date.now() - startTime
      }
    };
  }

  private async retryRequest<T>(request: APIRequest, attempt: number): Promise<APIResponse<T>> {
    if (!this.config.retryPolicy || attempt > this.config.retryPolicy.attempts) {
      throw new Error('Max retry attempts exceeded');
    }

    const delay = this.calculateRetryDelay(attempt);
    await this.sleep(delay);

    try {
      return await this.makeRequest<T>(request);
    } catch (error) {
      if (this.shouldRetry(error)) {
        return this.retryRequest(request, attempt + 1);
      }
      throw error;
    }
  }

  private shouldRetry(error: any): boolean {
    if (!this.config.retryPolicy) return false;
    
    if (this.config.retryPolicy.retryCondition) {
      return this.config.retryPolicy.retryCondition(error);
    }

    // Default retry conditions
    const retryableStatuses = [408, 429, 500, 502, 503, 504];
    return retryableStatuses.includes(error.response?.status);
  }

  private calculateRetryDelay(attempt: number): number {
    if (!this.config.retryPolicy) return 0;

    let delay = this.config.retryPolicy.baseDelay;
    
    switch (this.config.retryPolicy.backoff) {
      case 'exponential':
        delay = delay * Math.pow(2, attempt - 1);
        break;
      case 'linear':
        delay = delay * attempt;
        break;
      case 'fixed':
      default:
        // delay remains the same
        break;
    }

    if (this.config.retryPolicy.maxDelay) {
      delay = Math.min(delay, this.config.retryPolicy.maxDelay);
    }

    return delay;
  }

  private updateMetrics(success: boolean, duration: number): void {
    if (success) {
      this.metrics.avgResponseTime = 
        (this.metrics.avgResponseTime + duration) / 2;
    } else {
      this.metrics.errorCount++;
    }

    this.metrics.successRate = 
      (this.metrics.totalRequests - this.metrics.errorCount) / this.metrics.totalRequests;
  }

  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get client metrics
   */
  getMetrics(): APIMetrics {
    return { ...this.metrics };
  }

  /**
   * Update authentication credentials
   */
  updateCredentials(credentials: OAuth2Credentials | APIKeyCredentials | BearerCredentials | BasicCredentials): void {
    this.config.authStrategy.credentials = credentials;
  }
}

// =============================================
// API Framework
// =============================================

export class APIFramework {
  private clients: Map<string, APIClient> = new Map();
  private authStrategies: Map<string, AuthStrategy> = new Map();
  private retryPolicies: Map<string, RetryPolicy> = new Map();
  private transformers: Map<string, DataTransformer> = new Map();
  private rateLimits: Map<string, RateLimit> = new Map();

  /**
   * Create a new API client
   */
  createClient(config: APIConfig): APIClient {
    const client = new APIClient(config);
    this.clients.set(config.name, client);
    return client;
  }

  /**
   * Get an existing client
   */
  getClient(name: string): APIClient | undefined {
    return this.clients.get(name);
  }

  /**
   * Add a reusable auth strategy
   */
  addAuthStrategy(name: string, strategy: AuthStrategy): void {
    this.authStrategies.set(name, strategy);
  }

  /**
   * Add a reusable retry policy
   */
  addRetryPolicy(name: string, policy: RetryPolicy): void {
    this.retryPolicies.set(name, policy);
  }

  /**
   * Add a reusable transformer
   */
  addTransformer(transformer: DataTransformer): void {
    this.transformers.set(transformer.name, transformer);
  }

  /**
   * Add a reusable rate limit
   */
  addRateLimit(rateLimit: RateLimit): void {
    this.rateLimits.set(rateLimit.name, rateLimit);
  }

  /**
   * Create multiple clients for common integrations
   */
  createCommonClients(configs: { [provider: string]: Partial<APIConfig> }): { [provider: string]: APIClient } {
    const clients: { [provider: string]: APIClient } = {};
    
    for (const [provider, partialConfig] of Object.entries(configs)) {
      const fullConfig = this.getProviderDefaults(provider, partialConfig);
      clients[provider] = this.createClient(fullConfig);
    }
    
    return clients;
  }

  private getProviderDefaults(provider: string, config: Partial<APIConfig>): APIConfig {
    const defaults = this.getProviderDefaults_Internal(provider);
    
    return {
      ...defaults,
      ...config,
      name: config.name || provider,
      rateLimits: config.rateLimits || defaults.rateLimits,
      retryPolicy: config.retryPolicy || defaults.retryPolicy
    };
  }

  private getProviderDefaults_Internal(provider: string): Partial<APIConfig> {
    switch (provider.toLowerCase()) {
      case 'gmail':
        return {
          baseURL: 'https://gmail.googleapis.com/gmail/v1',
          rateLimits: [
            { name: 'requests', requests: 250, window: 1000, type: 'sliding' }
          ],
          retryPolicy: {
            attempts: 3,
            backoff: 'exponential',
            baseDelay: 1000,
            maxDelay: 10000
          }
        };
        
      case 'outlook':
        return {
          baseURL: 'https://graph.microsoft.com/v1.0',
          rateLimits: [
            { name: 'requests', requests: 300, window: 1000, type: 'sliding' }
          ],
          retryPolicy: {
            attempts: 3,
            backoff: 'exponential',
            baseDelay: 1000,
            maxDelay: 10000
          }
        };
        
      default:
        return {
          rateLimits: [
            { name: 'default', requests: 100, window: 1000, type: 'sliding' }
          ],
          retryPolicy: {
            attempts: 3,
            backoff: 'exponential',
            baseDelay: 1000
          }
        };
    }
  }

  /**
   * Get metrics for all clients
   */
  getAllMetrics(): { [clientName: string]: APIMetrics } {
    const metrics: { [clientName: string]: APIMetrics } = {};
    
    for (const [name, client] of this.clients.entries()) {
      metrics[name] = client.getMetrics();
    }
    
    return metrics;
  }

  /**
   * Shutdown all clients
   */
  async shutdown(): Promise<void> {
    for (const client of this.clients.values()) {
      client.removeAllListeners();
    }
    this.clients.clear();
  }
}

// =============================================
// Singleton Instance
// =============================================

export const apiFramework = new APIFramework(); 