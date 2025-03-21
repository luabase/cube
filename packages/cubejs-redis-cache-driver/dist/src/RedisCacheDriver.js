"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisCacheDriver = void 0;
const shared_1 = require("@cubejs-backend/shared");
const ioredis_1 = __importDefault(require("ioredis"));
class RedisCacheDriver {
    redis;
    url;
    namespace;
    logger;
    constructor(params) {
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
        this.redis = new ioredis_1.default(redisUrl);
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
    async get(key) {
        const namespacedKey = this.getNamespacedKey(key);
        const start = performance.now();
        const result = await this.redis.get(namespacedKey);
        const duration = performance.now() - start;
        this.logger('Getting cached result from redis', { requestId: '', duration: duration.toFixed(2), namespacedKey });
        return result ? JSON.parse(result) : null;
    }
    async set(key, value, expiration) {
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
    async remove(key) {
        const namespacedKey = this.getNamespacedKey(key);
        const start = performance.now();
        await this.redis.del(namespacedKey);
        const duration = performance.now() - start;
        this.logger('Removing cached key from redis', { requestId: '', duration: duration.toFixed(2), namespacedKey });
    }
    async keysStartingWith(prefix) {
        const namespacedKey = this.getNamespacedKey(prefix);
        const keys = [];
        let cursor = '0';
        try {
            do {
                const [newCursor, foundKeys] = await this.redis.scan(cursor, 'MATCH', `${namespacedKey}*`, 'COUNT', 100);
                cursor = newCursor;
                keys.push(...foundKeys);
            } while (cursor !== '0');
            return keys;
        }
        catch (error) {
            this.logger('Error scanning keys with prefix', { requestId: '', prefix, error });
            throw new Error('Failed to fetch keys from Redis');
        }
    }
    async cleanup() {
        // Nothing to do
    }
    async testConnection() {
        try {
            const start = performance.now();
            await this.redis.ping();
            const duration = performance.now() - start;
            this.logger('Redis ping successful', { requestId: '', duration: duration.toFixed(2), url: this.url });
        }
        catch (error) {
            this.logger('Redis connection failed', { requestId: '', error });
            throw new Error('Failed to connect to Redis');
        }
    }
    withLock = (key, cb, expiration = 60, freeAfter = true) => (0, shared_1.createCancelablePromise)(async (tkn) => {
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
            }
            finally {
                if (freeAfter) {
                    await this.redis.del(key);
                }
            }
            return true;
        }
        return false;
    });
    disconnect() {
        this.redis.disconnect();
    }
    getNamespacedKey(key) {
        return `${this.namespace}:${key}`;
    }
}
exports.RedisCacheDriver = RedisCacheDriver;
//# sourceMappingURL=RedisCacheDriver.js.map