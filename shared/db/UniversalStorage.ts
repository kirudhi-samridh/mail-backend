/**
 * Universal Storage Engine
 * 
 * High-performance database operations engine optimized for email data
 * with full-text search integration, bulk operations, and intelligent
 * conflict resolution strategies.
 */

import { eq, and, or, inArray, sql, SQL } from 'drizzle-orm';
import { PgDatabase } from 'drizzle-orm/pg-core';
import { db } from './connection';
import { emails, emailAttachments, emailEmbeddings } from './schema';
import { logger } from '../logging/logger';
import { Redis } from 'ioredis';
import { getRedisConnection } from '../redis/connection';

// =============================================
// Core Interfaces
// =============================================

export interface BatchInsertOptions {
  batchSize?: number;
  skipDuplicates?: boolean;
  onConflict?: 'ignore' | 'update' | 'error';
  validateData?: boolean;
  enableRetry?: boolean;
  maxRetries?: number;
}

export interface BatchUpdateOptions {
  batchSize?: number;
  whereClause?: WhereClause;
  enableOptimisticLocking?: boolean;
  updateTimestamp?: boolean;
}

export interface UpsertOptions {
  conflictFields: string[];
  updateOnConflict?: string[];
  batchSize?: number;
  skipValidation?: boolean;
}

export interface DeleteOptions {
  batchSize?: number;
  cascadeDelete?: boolean;
  softDelete?: boolean;
  archiveFirst?: boolean;
}

export interface PaginationOptions {
  page: number;
  limit: number;
  orderBy?: OrderByClause;
  cursor?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
    nextCursor?: string;
    previousCursor?: string;
  };
}

export interface WhereClause {
  [key: string]: any;
}

export interface OrderByClause {
  field: string;
  direction: 'asc' | 'desc';
}

export interface IndexOptions {
  unique?: boolean;
  type?: 'btree' | 'hash' | 'gin' | 'gist';
  concurrent?: boolean;
}

export interface OptimizedQuery {
  sql: string;
  estimatedCost: number;
  suggestedIndexes?: string[];
}

export interface CacheStats {
  hitRate: number;
  totalHits: number;
  totalMisses: number;
  memoryUsage: number;
}

// =============================================
// Advanced Search Interfaces
// =============================================

export interface AdvancedSearchQuery {
  query: string;
  filters?: SearchFilters;
  sorting?: SearchSorting;
  pagination?: PaginationOptions;
  highlights?: boolean;
  fuzzyMatch?: boolean;
  boostFields?: { [field: string]: number };
}

export interface SearchFilters {
  accountId?: string;
  userId?: string;
  dateRange?: {
    from: Date;
    to: Date;
  };
  fromAddresses?: string[];
  toAddresses?: string[];
  hasAttachments?: boolean;
  isRead?: boolean;
  isStarred?: boolean;
  labels?: string[];
  minPriorityScore?: number;
  folders?: string[];
}

export interface SearchSorting {
  field: 'relevance' | 'date' | 'priority' | 'subject';
  direction: 'asc' | 'desc';
}

export interface SearchResult<T> {
  results: SearchHit<T>[];
  pagination: PaginatedResult<T>['pagination'];
  aggregations?: SearchAggregations;
  searchMetadata: {
    query: string;
    totalHits: number;
    searchTime: number;
    maxScore: number;
  };
}

export interface SearchHit<T> {
  document: T;
  score: number;
  highlights?: { [field: string]: string[] };
  explanation?: string;
}

export interface SearchAggregations {
  senders?: { [sender: string]: number };
  dateHistogram?: { [date: string]: number };
  folders?: { [folder: string]: number };
  attachmentTypes?: { [type: string]: number };
}

// =============================================
// Attachment Storage Strategy
// =============================================

export interface AttachmentStorageStrategy {
  storeAttachment(emailId: string, attachment: AttachmentData): Promise<string>;
  getAttachment(attachmentId: string): Promise<AttachmentData | null>;
  deleteAttachment(attachmentId: string): Promise<void>;
  getAttachmentUrl(attachmentId: string, expiresIn?: number): Promise<string>;
}

export interface AttachmentData {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
  isInline?: boolean;
  contentId?: string;
}

// =============================================
// Universal Storage Engine
// =============================================

export class UniversalStorage<T = any> {
  private redis: Redis;
  private cachePrefix = 'storage:cache:';
  private cacheTTL = 3600; // 1 hour
  private searchClient: any; // Will be initialized with Elasticsearch/OpenSearch
  private attachmentStorage: AttachmentStorageStrategy;

  constructor(
    private database: PgDatabase<any> = db,
    searchClientConfig?: any,
    attachmentStorage?: AttachmentStorageStrategy
  ) {
    this.redis = getRedisConnection();
    this.attachmentStorage = attachmentStorage || new LocalAttachmentStorage();
    
    // Initialize search client if config provided
    if (searchClientConfig) {
      this.initializeSearchClient(searchClientConfig);
    }
  }

  // =============================================
  // Batch Operations
  // =============================================

  /**
   * Insert multiple records in optimized batches
   */
  async batchInsert<TData = T>(
    table: any,
    items: TData[],
    options: BatchInsertOptions = {}
  ): Promise<TData[]> {
    const startTime = Date.now();
    const batchSize = options.batchSize || 1000;
    const results: TData[] = [];

    try {
      // Process in batches to avoid memory issues
      const batches = this.chunk(items, batchSize);
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        
        logger.logDatabase('create', table._.name, true, {
          batchNumber: i + 1,
          batchSize: batch.length,
          totalBatches: batches.length
        });

        let batchResults: TData[];
        
        if (options.onConflict === 'ignore') {
          batchResults = await this.database
            .insert(table)
            .values(batch)
            .onConflictDoNothing()
            .returning();
        } else if (options.onConflict === 'update') {
          // Implement upsert logic
          batchResults = await this.batchUpsert(table, batch, {
            conflictFields: ['id'],
            ...options
          });
        } else {
          batchResults = await this.database
            .insert(table)
            .values(batch)
            .returning();
        }

        results.push(...batchResults);

        // Index in search engine if configured
        if (this.searchClient && table === emails) {
          await this.indexDocuments(batchResults as any);
        }
      }

      const duration = Date.now() - startTime;
      logger.logPerformance('batch_insert', duration, {
        table: table._.name,
        totalItems: items.length,
        batchSize,
        totalBatches: batches.length
      });

      return results;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.logDatabase('create', table._.name, false, {
        error: error.message,
        duration,
        itemCount: items.length
      });
      throw error;
    }
  }

  /**
   * Update multiple records with optimized batching
   */
  async batchUpdate<TData = T>(
    table: any,
    updates: Array<{ where: WhereClause; data: Partial<TData> }>,
    options: BatchUpdateOptions = {}
  ): Promise<TData[]> {
    const startTime = Date.now();
    const batchSize = options.batchSize || 500;
    const results: TData[] = [];

    try {
      const batches = this.chunk(updates, batchSize);

      for (const batch of batches) {
        for (const update of batch) {
          const whereCondition = this.buildWhereCondition(update.where);
          const result = await this.database
            .update(table)
            .set(update.data)
            .where(whereCondition)
            .returning();
          
          results.push(...result);
        }
      }

      const duration = Date.now() - startTime;
      logger.logPerformance('batch_update', duration, {
        table: table._.name,
        updateCount: updates.length
      });

      return results;

    } catch (error) {
      logger.logDatabase('update', table._.name, false, {
        error: error.message,
        updateCount: updates.length
      });
      throw error;
    }
  }

  /**
   * Upsert (insert or update) multiple records
   */
  async batchUpsert<TData = T>(
    table: any,
    items: TData[],
    options: UpsertOptions
  ): Promise<TData[]> {
    const startTime = Date.now();
    const batchSize = options.batchSize || 1000;
    const results: TData[] = [];

    try {
      const batches = this.chunk(items, batchSize);

      for (const batch of batches) {
        // Build conflict fields
        const conflictFields = options.conflictFields.map(field => table[field]);
        
        // Determine update fields
        const updateFields = options.updateOnConflict || 
          Object.keys(batch[0] as any).filter(key => !options.conflictFields.includes(key));

        const updateSet = updateFields.reduce((acc, field) => {
          acc[field] = sql`excluded.${sql.identifier(field)}`;
          return acc;
        }, {} as any);

        const result = await this.database
          .insert(table)
          .values(batch)
          .onConflictDoUpdate({
            target: conflictFields,
            set: updateSet
          })
          .returning();

        results.push(...result);
      }

      const duration = Date.now() - startTime;
      logger.logPerformance('batch_upsert', duration, {
        table: table._.name,
        itemCount: items.length
      });

      return results;

    } catch (error) {
      logger.logDatabase('sync', table._.name, false, {
        error: error.message,
        itemCount: items.length
      });
      throw error;
    }
  }

  /**
   * Delete records in bulk with safety checks
   */
  async bulkDelete(
    table: any,
    whereClause: WhereClause,
    options: DeleteOptions = {}
  ): Promise<number> {
    const startTime = Date.now();

    try {
      // Safety check: prevent accidental deletion of entire table
      if (Object.keys(whereClause).length === 0) {
        throw new Error('Bulk delete requires WHERE clause');
      }

      const whereCondition = this.buildWhereCondition(whereClause);
      
      if (options.softDelete) {
        // Soft delete by updating deleted_at timestamp
        const result = await this.database
          .update(table)
          .set({ deletedAt: new Date() })
          .where(whereCondition)
          .returning();
        
        return result.length;
      } else {
        const result = await this.database
          .delete(table)
          .where(whereCondition)
          .returning();
        
        return result.length;
      }

    } catch (error) {
      logger.logDatabase('delete', table._.name, false, {
        error: error.message,
        whereClause
      });
      throw error;
    }
  }

  // =============================================
  // Advanced Search Integration
  // =============================================

  /**
   * Perform advanced full-text search across emails
   */
  async search<TData = T>(
    searchQuery: AdvancedSearchQuery
  ): Promise<SearchResult<TData>> {
    const startTime = Date.now();

    try {
      if (!this.searchClient) {
        throw new Error('Search client not configured');
      }

      // Build Elasticsearch query
      const esQuery = this.buildElasticsearchQuery(searchQuery);
      
      const searchResponse = await this.searchClient.search({
        index: 'emails',
        body: esQuery
      });

      // Extract document IDs from search results
      const documentIds = searchResponse.body.hits.hits.map((hit: any) => hit._id);
      
      // Fetch full documents from database
      const documents = await this.database
        .select()
        .from(emails)
        .where(inArray(emails.id, documentIds));

      // Map search results with scores and highlights
      const results: SearchHit<TData>[] = searchResponse.body.hits.hits.map((hit: any) => {
        const document = documents.find(doc => doc.id === hit._id);
        return {
          document: document as TData,
          score: hit._score,
          highlights: hit.highlight,
          explanation: hit._explanation?.description
        };
      });

      const searchTime = Date.now() - startTime;
      
      logger.logPerformance('search_query', searchTime, {
        query: searchQuery.query,
        totalHits: searchResponse.body.hits.total.value,
        resultsReturned: results.length
      });

      return {
        results,
        pagination: this.buildSearchPagination(searchResponse, searchQuery.pagination),
        aggregations: this.buildSearchAggregations(searchResponse),
        searchMetadata: {
          query: searchQuery.query,
          totalHits: searchResponse.body.hits.total.value,
          searchTime,
          maxScore: searchResponse.body.hits.max_score
        }
      };

    } catch (error) {
      logger.logError('Search query failed', error as Error, {
        query: searchQuery.query
      });
      throw error;
    }
  }

  /**
   * Index documents in search engine
   */
  async indexDocuments(documents: any[]): Promise<void> {
    if (!this.searchClient) return;

    try {
      const body = documents.flatMap(doc => [
        { index: { _index: 'emails', _id: doc.id } },
        {
          subject: doc.subject,
          bodyText: doc.bodyText,
          bodyHtml: doc.bodyHtml,
          fromAddress: doc.fromAddress,
          fromName: doc.fromName,
          toAddresses: doc.toAddresses,
          receivedAt: doc.receivedAt,
          snippet: doc.snippet,
          hasAttachments: doc.hasAttachments,
          folderName: doc.folderName,
          accountId: doc.accountId
        }
      ]);

      await this.searchClient.bulk({ body });

    } catch (error) {
      logger.logError('Document indexing failed', error as Error, {
        documentCount: documents.length
      });
    }
  }

  // =============================================
  // Pagination & Querying
  // =============================================

  /**
   * Paginate through large result sets efficiently
   */
  async paginate<TData = T>(
    table: any,
    query: any,
    pagination: PaginationOptions
  ): Promise<PaginatedResult<TData>> {
    const startTime = Date.now();

    try {
      const offset = (pagination.page - 1) * pagination.limit;
      
      // Get total count
      const [countResult] = await this.database
        .select({ count: sql`count(*)::int` })
        .from(table)
        .where(query);
      
      const total = countResult.count;
      
      // Get paginated data
      let dbQuery = this.database
        .select()
        .from(table)
        .where(query)
        .limit(pagination.limit)
        .offset(offset);

      if (pagination.orderBy) {
        const orderDirection = pagination.orderBy.direction === 'desc' ? sql`desc` : sql`asc`;
        dbQuery = dbQuery.orderBy(sql`${sql.identifier(pagination.orderBy.field)} ${orderDirection}`);
      }

      const data = await dbQuery;
      
      const totalPages = Math.ceil(total / pagination.limit);
      
      const duration = Date.now() - startTime;
      logger.logPerformance('paginate_query', duration, {
        table: table._.name,
        page: pagination.page,
        limit: pagination.limit,
        total
      });

      return {
        data: data as TData[],
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          totalPages,
          hasNext: pagination.page < totalPages,
          hasPrevious: pagination.page > 1
        }
      };

    } catch (error) {
      logger.logDatabase('read', table._.name, false, {
        error: error.message,
        pagination
      });
      throw error;
    }
  }

  // =============================================
  // Performance & Optimization
  // =============================================

  /**
   * Create database indexes for performance
   */
  async createIndex(
    table: any,
    fields: string[],
    options: IndexOptions = {}
  ): Promise<void> {
    try {
      const indexName = `idx_${table._.name}_${fields.join('_')}`;
      const indexType = options.type || 'btree';
      const unique = options.unique ? 'UNIQUE' : '';
      const concurrent = options.concurrent ? 'CONCURRENTLY' : '';
      
      const fieldList = fields.map(field => sql.identifier(field)).join(', ');
      
      await this.database.execute(sql`
        CREATE ${sql.raw(unique)} INDEX ${sql.raw(concurrent)} ${sql.identifier(indexName)}
        ON ${table} USING ${sql.raw(indexType)} (${sql.raw(fieldList)})
      `);

      logger.logDatabase('create', 'index', true, {
        indexName,
        table: table._.name,
        fields,
        indexType
      });

    } catch (error) {
      logger.logDatabase('create', 'index', false, {
        error: error.message,
        table: table._.name,
        fields
      });
      throw error;
    }
  }

  /**
   * Analyze and optimize queries
   */
  async optimizeQuery(query: string): Promise<OptimizedQuery> {
    try {
      const explainResult = await this.database.execute(
        sql`EXPLAIN (ANALYZE true, BUFFERS true, FORMAT JSON) ${sql.raw(query)}`
      );

      const plan = explainResult[0];
      const executionTime = plan['Execution Time'];
      const totalCost = plan['Plan']['Total Cost'];

      return {
        sql: query,
        estimatedCost: totalCost,
        suggestedIndexes: this.analyzePlanForIndexSuggestions(plan)
      };

    } catch (error) {
      logger.logError('Query optimization failed', error as Error, { query });
      throw error;
    }
  }

  // =============================================
  // Caching Layer
  // =============================================

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<CacheStats> {
    try {
      const info = await this.redis.info('stats');
      const keyspaceHits = this.extractRedisStatValue(info, 'keyspace_hits');
      const keyspaceMisses = this.extractRedisStatValue(info, 'keyspace_misses');
      const usedMemory = this.extractRedisStatValue(info, 'used_memory');

      const totalRequests = keyspaceHits + keyspaceMisses;
      const hitRate = totalRequests > 0 ? keyspaceHits / totalRequests : 0;

      return {
        hitRate,
        totalHits: keyspaceHits,
        totalMisses: keyspaceMisses,
        memoryUsage: usedMemory
      };

    } catch (error) {
      logger.logError('Failed to get cache stats', error as Error);
      return {
        hitRate: 0,
        totalHits: 0,
        totalMisses: 0,
        memoryUsage: 0
      };
    }
  }

  // =============================================
  // Private Helper Methods
  // =============================================

  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private buildWhereCondition(whereClause: WhereClause): SQL {
    const conditions: SQL[] = [];
    
    for (const [key, value] of Object.entries(whereClause)) {
      if (Array.isArray(value)) {
        conditions.push(sql`${sql.identifier(key)} = ANY(${value})`);
      } else {
        conditions.push(sql`${sql.identifier(key)} = ${value}`);
      }
    }
    
    return conditions.length > 1 ? and(...conditions)! : conditions[0];
  }

  private buildElasticsearchQuery(searchQuery: AdvancedSearchQuery): any {
    const query: any = {
      query: {
        bool: {
          must: [],
          filter: []
        }
      },
      highlight: searchQuery.highlights ? {
        fields: {
          subject: {},
          bodyText: {},
          bodyHtml: {}
        }
      } : undefined,
      sort: this.buildSearchSort(searchQuery.sorting),
      from: searchQuery.pagination ? (searchQuery.pagination.page - 1) * searchQuery.pagination.limit : 0,
      size: searchQuery.pagination?.limit || 20
    };

    // Main search query
    if (searchQuery.query) {
      query.query.bool.must.push({
        multi_match: {
          query: searchQuery.query,
          fields: ['subject^3', 'bodyText^2', 'fromName', 'snippet'],
          fuzziness: searchQuery.fuzzyMatch ? 'AUTO' : undefined
        }
      });
    }

    // Apply filters
    if (searchQuery.filters) {
      this.addSearchFilters(query.query.bool.filter, searchQuery.filters);
    }

    return query;
  }

  private buildSearchSort(sorting?: SearchSorting): any[] {
    if (!sorting) {
      return [{ _score: { order: 'desc' } }];
    }

    const field = sorting.field === 'relevance' ? '_score' : 
                  sorting.field === 'date' ? 'receivedAt' : sorting.field;

    return [{ [field]: { order: sorting.direction } }];
  }

  private addSearchFilters(filters: any[], searchFilters: SearchFilters): void {
    if (searchFilters.accountId) {
      filters.push({ term: { accountId: searchFilters.accountId } });
    }

    if (searchFilters.dateRange) {
      filters.push({
        range: {
          receivedAt: {
            gte: searchFilters.dateRange.from.toISOString(),
            lte: searchFilters.dateRange.to.toISOString()
          }
        }
      });
    }

    if (searchFilters.fromAddresses?.length) {
      filters.push({ terms: { fromAddress: searchFilters.fromAddresses } });
    }

    if (searchFilters.hasAttachments !== undefined) {
      filters.push({ term: { hasAttachments: searchFilters.hasAttachments } });
    }

    if (searchFilters.isRead !== undefined) {
      filters.push({ term: { isRead: searchFilters.isRead } });
    }
  }

  private buildSearchPagination(searchResponse: any, pagination?: PaginationOptions): PaginatedResult<any>['pagination'] {
    const total = searchResponse.body.hits.total.value;
    const limit = pagination?.limit || 20;
    const page = pagination?.page || 1;
    const totalPages = Math.ceil(total / limit);

    return {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1
    };
  }

  private buildSearchAggregations(searchResponse: any): SearchAggregations | undefined {
    return searchResponse.body.aggregations ? {
      senders: searchResponse.body.aggregations.senders?.buckets?.reduce((acc: any, bucket: any) => {
        acc[bucket.key] = bucket.doc_count;
        return acc;
      }, {}),
      // Add other aggregations as needed
    } : undefined;
  }

  private analyzePlanForIndexSuggestions(plan: any): string[] {
    // Analyze query plan and suggest indexes
    // This is a simplified implementation
    const suggestions: string[] = [];
    
    if (plan['Plan']['Node Type'] === 'Seq Scan') {
      suggestions.push(`Consider adding index on frequently queried columns for table ${plan['Plan']['Relation Name']}`);
    }
    
    return suggestions;
  }

  private extractRedisStatValue(info: string, stat: string): number {
    const match = info.match(new RegExp(`${stat}:(\\d+)`));
    return match ? parseInt(match[1], 10) : 0;
  }

  private initializeSearchClient(config: any): void {
    // Initialize Elasticsearch/OpenSearch client
    // Implementation depends on chosen search engine
    // this.searchClient = new Client(config);
  }
}

// =============================================
// Local Attachment Storage (Fallback)
// =============================================

class LocalAttachmentStorage implements AttachmentStorageStrategy {
  async storeAttachment(emailId: string, attachment: AttachmentData): Promise<string> {
    // Store attachment in database for now
    // In production, this would use S3 or similar object storage
    const [result] = await db.insert(emailAttachments).values({
      emailId,
      filename: attachment.filename,
      contentType: attachment.contentType,
      sizeBytes: attachment.size,
      isInline: attachment.isInline || false
    }).returning();

    return result.id;
  }

  async getAttachment(attachmentId: string): Promise<AttachmentData | null> {
    const [attachment] = await db
      .select()
      .from(emailAttachments)
      .where(eq(emailAttachments.id, attachmentId))
      .limit(1);

    if (!attachment) return null;

    return {
      filename: attachment.filename,
      contentType: attachment.contentType || 'application/octet-stream',
      size: attachment.sizeBytes || 0,
      content: Buffer.from(''), // Would fetch from actual storage
      isInline: attachment.isInline
    };
  }

  async deleteAttachment(attachmentId: string): Promise<void> {
    await db.delete(emailAttachments).where(eq(emailAttachments.id, attachmentId));
  }

  async getAttachmentUrl(attachmentId: string, expiresIn?: number): Promise<string> {
    // Return a temporary URL for downloading the attachment
    return `/api/attachments/${attachmentId}`;
  }
}

// =============================================
// Singleton Instance
// =============================================

export const universalStorage = new UniversalStorage(); 