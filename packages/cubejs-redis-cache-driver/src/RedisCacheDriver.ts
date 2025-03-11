import { createCancelablePromise, MaybeCancelablePromise } from '@cubejs-backend/shared';
import { CacheDriverInterface } from '@cubejs-backend/base-driver';
import Redis from 'ioredis';

export class RedisCacheDriver implements CacheDriverInterface {
  private redis: Redis;

  private url: string;

  private namespace: string;

  private logger: any;

  public constructor(params: { logger: any }) {
    const redisUrl = process.env.CUBEJS_DEFINITE_REDIS_QUERY_CACHE_URL;
    if (!redisUrl) {
      throw Error('CUBEJS_DEFINITE_REDIS_QUERY_CACHE_URL is not defined');
    }

    const redisNamespace = process.env.CUBEJS_DEFINITE_REDIS_QUERY_CACHE_NAMESPACE;
    if (!redisNamespace) {
      throw Error('CUBEJS_DEFINITE_REDIS_QUERY_CACHE_NAMESPACE is not defined');
    }

    this.logger = params.logger;
    this.namespace = redisNamespace;
    this.url = redisUrl;
    this.redis = new Redis(redisUrl);

    this.redis.on('error', error => {
      this.logger('Redis connection error', { requestId: '', url: redisUrl, error });
    });

    this.redis.on('ready', () => {
      this.logger('Connected to Redis successfully', { requestId: '', url: redisUrl, namespace: redisNamespace });
    });

    this.redis.on('reconnecting', () => {
      this.logger('Reconnecting to Redis...', { requestId: '', url: redisUrl });
    });

    this.redis.on('end', () => {
      this.logger('Disconnected from Redis', { requestId: '', url: redisUrl });
    });
  }

  public async get<R>(key: string): Promise<R | null> {
    const namespacedKey = this.getNamespacedKey(key);
    const start = performance.now();
    const result = await this.redis.get(namespacedKey);
    const duration = performance.now() - start;
    this.logger('Getting cached result from redis', { requestId: '', duration: duration.toFixed(2), namespacedKey });
    return result ? JSON.parse(result) : null;
  }

  public async set(key: string, value: unknown, expiration: number): Promise<{ key: string, bytes: number }> {
    const namespacedKey = this.getNamespacedKey(key);
    const strValue = JSON.stringify(value);
    const start = performance.now();
    await this.redis.set(namespacedKey, strValue, 'EX', expiration);
    const duration = performance.now() - start;
    this.logger('Storing result in redis', { requestId: '', duration: duration.toFixed(2), namespacedKey });
    return {
      key,
      bytes: Buffer.byteLength(strValue),
    };
  }

  public async remove(key: string): Promise<void> {
    const namespacedKey = this.getNamespacedKey(key);
    const start = performance.now();
    await this.redis.del(namespacedKey);
    const duration = performance.now() - start;
    this.logger('Removing cached key from redis', { requestId: '', duration: duration.toFixed(2), namespacedKey });
  }

  public async keysStartingWith(prefix: string): Promise<string[]> {
    const namespacedKey = this.getNamespacedKey(prefix);
    const keys: string[] = [];
    let cursor = '0';

    try {
      do {
        const [newCursor, foundKeys] = await this.redis.scan(cursor, 'MATCH', `${namespacedKey}*`, 'COUNT', 100);
        cursor = newCursor;
        keys.push(...foundKeys);
      } while (cursor !== '0');

      return keys;
    } catch (error) {
      this.logger('Error scanning keys with prefix', { requestId: '', prefix, error });
      throw new Error('Failed to fetch keys from Redis');
    }
  }

  public async cleanup(): Promise<void> {
    // Nothing to do
  }

  public async testConnection(): Promise<void> {
    try {
      const start = performance.now();
      await this.redis.ping();
      const duration = performance.now() - start;
      this.logger('Redis ping successful', { requestId: '', duration: duration.toFixed(2), url: this.url });
    } catch (error) {
      this.logger('Redis connection failed', { requestId: '', error });
      throw new Error('Failed to connect to Redis');
    }
  }

  public withLock = (
    key: string,
    cb: () => MaybeCancelablePromise<any>,
    expiration: number = 60,
    freeAfter: boolean = true,
  ) => createCancelablePromise(async (tkn) => {
    if (tkn.isCanceled()) {
      return false;
    }

    const lockSet = await this.redis.set(key, '1', 'EX', expiration, 'NX');

    if (lockSet === 'OK') {
      if (tkn.isCanceled()) {
        if (freeAfter) {
          await this.redis.del(key);
        }
        return false;
      }

      try {
        await tkn.with(cb());
      } finally {
        if (freeAfter) {
          await this.redis.del(key);
        }
      }

      return true;
    }

    return false;
  });

  public disconnect(): void {
    this.redis.disconnect();
  }

  private getNamespacedKey(key: string): string {
    return `${this.namespace}:${key}`;
  }
}
