import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import {
  BaseDriver,
  DriverInterface,
  QueryOptions,
  GenericDataBaseType,
} from '@cubejs-backend/base-driver';
import {
  getEnv,
  assertDataSource,
} from '@cubejs-backend/shared';
import { Table, tableFromIPC } from 'apache-arrow';

import { DuckDBServerQuery } from './DuckDBServerQuery';
import { transformValue } from './transform';

export type DuckDBServerDriverConfiguration = {
  initSql?: string,
  database?: string,
  environment?: string,
  path?: string
  schema?: string,
  url?: string,
};

const DuckDBServerToGenericType: Record<string, GenericDataBaseType> = {
  // DATE_TRUNC returns DATE, but Cube Store still doesn't support DATE type
  // DuckDB's driver transform date/timestamp to Date object, but HydrationStream converts any Date object to ISO timestamp
  // That's why It's safe to use timestamp here
  date: 'timestamp',
};

export class DuckDBServerDriver extends BaseDriver implements DriverInterface {
  protected readonly client: AxiosInstance;

  private database: string;

  private environment?: string;

  private path?: string;

  private schema: string;

  public constructor(
    protected readonly config: DuckDBServerDriverConfiguration & {
      /**
       * Data source name.
       */
      dataSource?: string,

      /**
       * Max pool size value for the [cube]<-->[db] pool.
       */
      maxPoolSize?: number,

      /**
       * Time to wait for a response from a connection after validation
       * request before determining it as not valid. Default - 10000 ms.
       */
      testConnectionTimeout?: number,
    } = {},
  ) {
    super({
      testConnectionTimeout: config.testConnectionTimeout,
    });

    const dataSource =
      config.dataSource ||
      assertDataSource('default');

    let url = config.url || getEnv('dbUrl', { dataSource });

    if (!url) {
      const host = getEnv('dbHost', { dataSource });
      const port = getEnv('dbPort', { dataSource });
      if (host && port) {
        const protocol = getEnv('dbSsl', { dataSource })
          ? 'https'
          : 'http';
        url = `${protocol}://${host}:${port}`;
      } else {
        throw new Error('Please specify CUBEJS_DB_URL');
      }
    }

    this.database = config.database || getEnv('dbName', { dataSource });
    this.environment = config.environment || process.env['CUBEJS_DB_DUCKDB_SERVER_ENVIRONMENT'];
    this.path = config.path || process.env['CUBEJS_DB_DUCKDB_SERVER_DATABASE_PATH'];
    this.schema = config.schema || getEnv('duckdbSchema', { dataSource });

    this.config = {
      url,
      ...config,
    };

    this.client = axios.create({ baseURL: url });

    this.client.interceptors.request.use(
      (request: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
        console.log('DuckDB Server query', {
          method: request.method?.toUpperCase(),
          url: `${request.baseURL}${request.url}`,
          headers: JSON.stringify(request.headers, null, 2),
          data: JSON.stringify(request.data, null, 2)
        });
        return request;
      },
      (error) => Promise.reject(error)
    );
  }

  public readOnly() {
    return false;
  }

  public async testConnection() {
    await this.query('SELECT 1');
  }

  public override informationSchemaQuery(): string {
    if (this.schema) {
      return `${super.informationSchemaQuery()} AND table_catalog = '${this.schema}'`;
    }

    return super.informationSchemaQuery();
  }

  public override getSchemasQuery(): string {
    if (this.schema) {
      return `
        SELECT table_schema as ${super.quoteIdentifier('schema_name')}
        FROM information_schema.tables
        WHERE table_catalog = '${this.schema}'
        GROUP BY table_schema
      `;
    }
    return super.getSchemasQuery();
  }

  public static dialectClass() {
    return DuckDBServerQuery;
  }

  public toGenericType(columnType: string): GenericDataBaseType {
    if (columnType.toLowerCase() in DuckDBServerToGenericType) {
      return DuckDBServerToGenericType[columnType.toLowerCase()];
    }

    return super.toGenericType(columnType.toLowerCase());
  }

  protected async fetchAsync(sql: string, args: unknown[], persist: boolean = false): Promise<Table> {
    const start = performance.now();

    const data = {
      sql,
      args,
      database: this.path ? [this.database, this.path].join('/') : this.database,
      dynamic: this.environment,
      type: 'arrow',
      persist
    };

    const headers = {
      'Content-Type': 'application/json'
    };

    try {
      const response = await this.client.post('/', data, {
        headers,
        responseType: 'arraybuffer'
      });
      return tableFromIPC(new Uint8Array(response.data));
    } catch (e) {
      if (e instanceof AxiosError && e.response) {
        throw new Error(e.response.data);
      } else {
        throw e;
      }
    } finally {
      const duration = performance.now() - start;
      console.log(`[DuckDBServerDriver] Fetch finished in ${duration.toFixed(2)} ms`);
    }
  }

  public async query<R = unknown>(query: string, args: unknown[] = [], _options?: QueryOptions): Promise<R[]> {
    const queryStart = performance.now();
    const result = await this.fetchAsync(query, args, false);

    const transformStart = performance.now();
    const jsonResult = [];
    for (const row of result) {
      const jsonRow: Record<string, any> = {};
      result.schema.fields.forEach(field => {
        jsonRow[field.name] = transformValue(field, row[field.name]);
      });
      jsonResult.push(jsonRow);
    }

    const transformDuration = performance.now() - transformStart;
    const queryDuration = performance.now() - queryStart;
    console.log(`[DuckDBServerDriver] Transform finished in ${transformDuration.toFixed(2)} ms`);
    console.log(`[DuckDBServerDriver] Query finished in ${queryDuration.toFixed(2)} ms`);
    return jsonResult as R[];
  }
}
