/** ISO-8601 UTC timestamp for records. */
export function now(): string {
  return new Date().toISOString();
}
