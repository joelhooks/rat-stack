# Shared Basin infrastructure

`@rat-stack/basin` declares the storage pipeline shared by events and intake. It has no event schemas, capture middleware, or intake behavior.

- `basinStream(name)` declares a retained R2 bucket and a private Pipelines stream.
- `icebergSink(options)` declares a retained Data Catalog, Iceberg sink, and `SELECT *` pipeline.
- `CatalogMaintenance` types the caller's compaction and snapshot-expiration settings.
- `IcebergSinkOptions` types the sink's names, table, and maintenance settings.

The caller supplies each resource prefix. The declarations keep these logical IDs:

```text
${name}Bucket
${name}Stream
${name}Catalog
${name}Sink
${name}Pipeline
```

`icebergSink` reads `EVENTS_SINK_TOKEN` from the deploy environment, as before the extraction. Moving the helpers does not change resource IDs, props, retention, SQL, or token resolution. Events still owns its visitor salt and `events_raw` table selection. Intake still owns its table selection and maintenance policy.

## Check

Run `pnpm --filter @rat-stack/basin test`. The declaration property checks private ingest, retained resources, and isolated caller names, tables, and maintenance settings. It declares an in-memory Alchemy Stack without applying resources.

Other packages import these helpers from `@rat-stack/basin`, never from `@rat-stack/events/basin`. The cross-layer import rule enforces this boundary.

Events no longer blocks its own removal through Basin. `packages/events/README.md` shows how to remove the cartridge.
