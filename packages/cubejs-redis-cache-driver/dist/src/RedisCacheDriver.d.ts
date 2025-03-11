import { MaybeCancelablePromise } from '@cubejs-backend/shared';
import { CacheDriverInterface } from '@cubejs-backend/base-driver';
export declare class RedisCacheDriver implements CacheDriverInterface {
    private redis;
    private namespace;
    private logger;
    constructor(params: {
        logger: any;
    });
    get<R>(key: string): Promise<R | null>;
    set(key: string, value: unknown, expiration: number): Promise<{
        key: string;
        bytes: number;
    }>;
    remove(key: string): Promise<void>;
    keysStartingWith(prefix: string): Promise<string[]>;
    cleanup(): Promise<void>;
    testConnection(): Promise<void>;
    withLock: (key: string, cb: () => MaybeCancelablePromise<any>, expiration?: number, freeAfter?: boolean) => import("@cubejs-backend/shared").CancelablePromise<boolean>;
    disconnect(): void;
    private getNamespacedKey;
}
//# sourceMappingURL=RedisCacheDriver.d.ts.map