import { testQueries } from '../src/tests/testQueries';

testQueries('clickhouse', {
  includeIncrementalSchemaSuite: true,
  extendedEnv: 'export-bucket-s3'
});
