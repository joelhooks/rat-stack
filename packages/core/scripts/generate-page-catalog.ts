// @effect-diagnostics-next-line nodeBuiltinImport:off -- This Node-only build tool emits ignored JSON hints and is never imported by a runtime.
import * as fs from "node:fs";

// @ts-expect-error -- Node source generation loads the catalogue before compiled outputs exist.
import { pageCatalog, pageCatalogMetadata } from "../src/page-catalog.ts";

const directory = new URL("../src/.generated/", import.meta.url);

const output = new URL("page-catalog.json", directory);

const contents = `${JSON.stringify({ metadata: pageCatalogMetadata, schema: pageCatalog.jsonSchema() }, null, 2)}\n`;

fs.mkdirSync(directory, { recursive: true });

const previous = fs.existsSync(output) ? fs.readFileSync(output, "utf-8") : "";

if (previous !== contents) {
  const temporary = new URL(`page-catalog.${process.pid}.tmp`, directory);

  fs.writeFileSync(temporary, contents);
  fs.renameSync(temporary, output);
}
