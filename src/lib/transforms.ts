/**
 * Converts snake_case database rows to camelCase TypeScript objects.
 * Handles nested objects and arrays recursively.
 */
export function toCamelCase<T = Record<string, unknown>>(obj: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const key in obj) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const value = obj[key];
    if (Array.isArray(value)) {
      result[camelKey] = value.map(item =>
        item && typeof item === 'object' && !(item instanceof Date)
          ? toCamelCase(item as Record<string, unknown>)
          : item
      );
    } else if (value && typeof value === 'object' && !(value instanceof Date)) {
      result[camelKey] = toCamelCase(value as Record<string, unknown>);
    } else {
      result[camelKey] = value;
    }
  }
  return result as T;
}

/**
 * Converts camelCase TypeScript objects to snake_case for database writes.
 * Handles nested objects and arrays recursively.
 */
export function toSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key in obj) {
    const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    const value = obj[key];
    if (Array.isArray(value)) {
      result[snakeKey] = value.map(item =>
        item && typeof item === 'object' && !(item instanceof Date)
          ? toSnakeCase(item as Record<string, unknown>)
          : item
      );
    } else if (value && typeof value === 'object' && !(value instanceof Date)) {
      result[snakeKey] = toSnakeCase(value as Record<string, unknown>);
    } else {
      result[snakeKey] = value;
    }
  }
  return result;
}

/**
 * Transform an array of snake_case database rows to camelCase typed objects.
 */
export function transformRows<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map(row => toCamelCase<T>(row));
}
