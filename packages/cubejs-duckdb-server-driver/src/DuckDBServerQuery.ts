import { BaseFilter, BaseQuery, BaseTimeDimension } from '@cubejs-backend/schema-compiler';

const GRANULARITY_TO_INTERVAL: Record<string, (date: string) => string> = {
  day: date => `DATE_TRUNC('day', ${date})`,
  week: date => `DATE_TRUNC('week', ${date})`,
  hour: date => `DATE_TRUNC('hour', ${date})`,
  minute: date => `DATE_TRUNC('minute', ${date})`,
  second: date => `DATE_TRUNC('second', ${date})`,
  month: date => `DATE_TRUNC('month', ${date})`,
  quarter: date => `DATE_TRUNC('quarter', ${date})`,
  year: date => `DATE_TRUNC('year', ${date})`
};

class DuckDBServerFilter extends BaseFilter {
}

export class DuckDBServerQuery extends BaseQuery {
  public newFilter(filter: any): BaseFilter {
    return new DuckDBServerFilter(this, filter);
  }

  public convertTz(field: string) {
    return `timezone('${this.timezone}', ${field}::timestamptz)`;
  }

  public timeGroupedColumn(granularity: string, dimension: string) {
    return GRANULARITY_TO_INTERVAL[granularity](dimension);
  }

  public runningTotalDateJoinCondition() {
    return this.timeDimensions.map(
      (d: BaseTimeDimension) => [
        d,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (dateFrom: string, dateTo: string, dateField: string, dimensionDateFrom: string, dimensionDateTo: string) => `${this.timeStampCast(dateField)} >= ${this.timeStampCast(dimensionDateFrom)} AND ${this.timeStampCast(dateField)} <= ${dateTo}`
      ]
    );
  }

  public rollingWindowToDateJoinCondition(granularity: string) {
    return this.timeDimensions.map(
      (d: BaseTimeDimension) => [
        d,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (dateFrom: string, dateTo: string, dateField: string, dimensionDateFrom: string, dimensionDateTo: string, isFromStartToEnd: string) => `${this.timeStampCast(dateField)} >= ${this.timeGroupedColumn(granularity, dateFrom)} AND ${this.timeStampCast(dateField)} <= ${dateTo}`
      ]
    );
  }

  public rollingWindowDateJoinCondition(trailingInterval: string, leadingInterval: string, offset: string) {
    offset = offset || 'end';
    return this.timeDimensions.map(
      (d: BaseTimeDimension) => [d, (dateFrom: string, dateTo: string, dateField: string, dimensionDateFrom: string, dimensionDateTo: string, isFromStartToEnd: string) => {
        // dateFrom based window
        const conditions = [];
        if (trailingInterval !== 'unbounded') {
          const startDate = isFromStartToEnd || offset === 'start' ? dateFrom : dateTo;
          const trailingStart = trailingInterval ? this.subtractInterval(startDate, trailingInterval) : startDate;
          const sign = offset === 'start' ? '>=' : '>';
          conditions.push(`${dateField}::timestamptz ${sign} ${trailingStart}`);
        }
        if (leadingInterval !== 'unbounded') {
          const endDate = isFromStartToEnd || offset === 'end' ? dateTo : dateFrom;
          const leadingEnd = leadingInterval ? this.addInterval(endDate, leadingInterval) : endDate;
          const sign = offset === 'end' ? '<=' : '<';
          conditions.push(`${dateField}::timestamptz ${sign} ${leadingEnd}`);
        }
        return conditions.length ? conditions.join(' AND ') : '1 = 1';
      }]
    );
  }

  /**
   * Returns sql for source expression floored to timestamps aligned with
   * intervals relative to origin timestamp point.
   * DuckDB operates with whole intervals as is without measuring them in plain seconds,
   * so the resulting date will be human-expected aligned with intervals.
   */
  public dateBin(interval: string, source: string, origin: string): string {
    const timeUnit = this.diffTimeUnitForInterval(interval);
    const beginOfTime = this.timeStampCast('\'1970-01-01 00:00:00.000\'');

    return `${this.timeStampCast(`'${origin}'`)}' + INTERVAL '${interval}' *
      floor(
        date_diff('${timeUnit}', ${this.timeStampCast(`'${origin}'`)}, ${source}) /
        date_diff('${timeUnit}', ${beginOfTime}, ${beginOfTime} + INTERVAL '${interval}')
      )::int`;
  }

  public countDistinctApprox(sql: string) {
    return `approx_count_distinct(${sql})`;
  }

  public sqlTemplates() {
    const templates = super.sqlTemplates();
    templates.functions.DATETRUNC = 'DATE_TRUNC({{ args_concat }})';
    templates.functions.LEAST = 'LEAST({{ args_concat }})';
    templates.functions.GREATEST = 'GREATEST({{ args_concat }})';
    templates.filters.time_range_filter = '{{ column }}::timestamptz >= {{ from_timestamp }} AND {{ column }}::timestamptz <= {{ to_timestamp }}';
    console.log('+++ SQL TEMPLATES', templates);
    return templates;
  }
}
