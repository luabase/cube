import { DataType, Field } from 'apache-arrow';

export function transformValue(field: Field, value: any) {
  console.log('DuckDB Server transform value', { field, value });

  if (value === null || value === undefined || DataType.isNull(field.type)) {
    return value;
  } if (typeof value === 'bigint') {
    return value.toString();
  } else if (DataType.isInt(field.type)) {
    return Number(value);
  } else if (DataType.isFloat(field.type)) {
    return Number(value);
  } else if (DataType.isBool(field.type)) {
    return Boolean(value);
  } else if (DataType.isDecimal(field.type)) {
    return value.toString();
  } else if (DataType.isDate(field.type) || DataType.isTimestamp(field.type)) {
    return new Date(value).toISOString();
  }

  return value;
}
