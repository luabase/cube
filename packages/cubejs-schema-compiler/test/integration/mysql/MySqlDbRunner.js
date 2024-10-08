import { promisify } from 'util';
import { GenericContainer } from 'testcontainers';
import mysql from 'mysql';
import { BaseDbRunner } from '../utils/BaseDbRunner';
import { MysqlQuery } from '../../../src';

export class MySqlDbRunner extends BaseDbRunner {
  async connectionLazyInit(port) {
    return {
      testQueries: async (queries, fixture) => {
        const conn = mysql.createConnection({
          host: 'localhost',
          port,
          user: 'root',
          database: 'mysql',
          password: this.password(),
          dateStrings: true
        });
        const connect = promisify(conn.connect.bind(conn));

        conn.execute = promisify(conn.query.bind(conn));

        await connect();

        try {
          await this.prepareFixture(conn, fixture);
          return await queries
            .map(query => async () => JSON.parse(JSON.stringify(await conn.execute(query[0], query[1]))))
            .reduce((a, b) => a.then(b), Promise.resolve());
        } finally {
          await promisify(conn.end.bind(conn))();
        }
      }
    };
  }

  tempTableSql(desc) {
    return desc.loadSql[0].replace('CREATE TABLE', 'CREATE TEMPORARY TABLE');
  }

  async prepareFixture(conn) {
    const query = conn.execute;
    await query('CREATE TEMPORARY TABLE visitors (id INT, amount INT, created_at datetime, updated_at datetime, status INT, source VARCHAR(255), latitude DECIMAL, longitude DECIMAL)');
    await query('CREATE TEMPORARY TABLE visitor_checkins (id INT, visitor_id INT, created_at datetime, source VARCHAR(255))');
    await query('CREATE TEMPORARY TABLE cards (id INT, visitor_id INT, visitor_checkin_id INT)');
    await query(`
    INSERT INTO
    visitors
    (id, amount, created_at, updated_at, status, source, latitude, longitude) VALUES
    (1, 100, '2017-01-03', '2017-01-30', 1, 'some', 120.120, 40.60),
    (2, 200, '2017-01-05', '2017-01-15', 1, 'some', 120.120, 58.60),
    (3, 300, '2017-01-06', '2017-01-20', 2, 'google', 120.120, 70.60),
    (4, 400, '2017-01-07', '2017-01-25', 2, NULL, 120.120, 10.60),
    (5, 500, '2017-01-07', '2017-01-25', 2, NULL, 120.120, 58.10),
    (6, 500, '2016-09-07', '2016-09-07', 2, NULL, 120.120, 58.10)
    `);
    await query(`
    INSERT INTO
    visitor_checkins
    (id, visitor_id, created_at, source) VALUES
    (1, 1, '2017-01-03', NULL),
    (2, 1, '2017-01-04', NULL),
    (3, 1, '2017-01-05', 'google'),
    (4, 2, '2017-01-05', NULL),
    (5, 2, '2017-01-05', NULL),
    (6, 3, '2017-01-06', NULL)
    `);
    await query(`
    INSERT INTO
    cards
    (id, visitor_id, visitor_checkin_id) VALUES
    (1, 1, 1),
    (2, 1, 2),
    (3, 3, 6)
    `);
    await query('CREATE TEMPORARY TABLE numbers (num INT);');
    await query(`
    INSERT INTO numbers (num) VALUES (0), (1), (2), (3), (4), (5), (6), (7), (8), (9),
                                  (10), (11), (12), (13), (14), (15), (16), (17), (18), (19),
                                  (20), (21), (22), (23), (24), (25), (26), (27), (28), (29),
                                  (30), (31), (32), (33), (34), (35), (36), (37), (38), (39),
                                  (40), (41), (42), (43), (44), (45), (46), (47), (48), (49),
                                  (50), (51), (52), (53), (54), (55), (56), (57), (58), (59);
    `);
  }

  password() {
    return process.env.TEST_DB_PASSWORD || 'Test1test';
  }

  async containerLazyInit() {
    const version = process.env.TEST_MYSQL_VERSION || '5.7';

    return new GenericContainer(`mysql:${version}`)
      .withEnvironment({ MYSQL_ROOT_PASSWORD: this.password() })
      .withExposedPorts(this.port())
      // workaround for MySQL 8 unsupported auth
      .withCommand(['--default-authentication-plugin=mysql_native_password'])
      .start();
  }

  port() {
    return 3306;
  }

  newTestQuery(compilers, query) {
    return new MysqlQuery(compilers, query);
  }
}
