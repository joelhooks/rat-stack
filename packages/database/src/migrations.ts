// @effect-diagnostics-next-line nodeBuiltinImport:off -- Deploy props and local migration loaders share this synchronous path conversion.
import path from "node:path";
import { fileURLToPath } from "node:url";

export type DatabaseMigrationVendor = "d1" | "postgres";

const databasePathFromCwd = (location: string): string =>
  path.relative(
    process.cwd(),
    fileURLToPath(new URL(location, import.meta.url))
  );

export const databaseMigrationDirectory = (
  vendor: DatabaseMigrationVendor
): string => databasePathFromCwd(`../migrations/${vendor}/`);

export const databaseSchemaFile = (vendor: DatabaseMigrationVendor): string =>
  databasePathFromCwd(`../src/schema/${vendor}.ts`);
