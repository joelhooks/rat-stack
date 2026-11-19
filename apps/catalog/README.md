# Catalog server

This private Worker hosts the Catalog Domain model and its D1 index. The Item event log is authoritative. `CatalogIndex` projects committed sightings and decisions through `CatalogStore`; D1 is a replaceable copy.

## Provision the operator token

The owner supplies `CATALOG_OPERATOR_TOKEN` through the approved deployment configuration. The variable is sensitive and optional in `.env.schema`. Worker props bind a configured value through Alchemy's redacted environment binding, which Cloudflare stores as `secret_text`. The runtime Config reader receives the secret through Alchemy's environment decoding.

1. Make the value available to the authorized deployment process without putting it in a command argument or source file.
2. Run the production infrastructure plan with that configuration.
3. Confirm the secret binding updates `CatalogWorker` without replacing its Durable Object namespaces.
4. Deploy through the owner workflow, then run the smoke below with the same value supplied securely in the environment.

Changing deployment configuration requires another deploy. Missing or empty configuration denies all Api operations. No operator token value ships in source.

## Smoke

```sh
pnpm --filter @rat-stack/catalog-server smoke <url>
```

The command reads `CATALOG_OPERATOR_TOKEN` from its environment through Effect Config. It calls native `OperatorApi.clientHttp(...).ItemHistory.get` first without credentials, expecting typed Unauthorized. It then calls with the token, accepting a successful read or a missing-item result. The URL must use HTTPS and contain no embedded credentials. Plain HTTP is accepted only for exact `localhost` and `127.0.0.1`. Failures exit nonzero with a sanitized phase; neither HTTP errors nor token values are printed. The probe has an initial 30-second total deadline through `smokeDeadline`, a Context.Reference. A timeout leaves the target unverified; it does not claim an authentication rejection.

A raw GET is not an auth or health check. The pinned native RPC server accepts an empty NDJSON request without dispatching a model operation and returns an empty 200 response. No extra GET guard is installed because WebSocket reads legitimately use GET.

## Backfill

```sh
pnpm --filter @rat-stack/catalog-server backfill <directory> --dry-run
pnpm --filter @rat-stack/catalog-server backfill <directory> --url <worker-url> [--concurrency <n>] [--from <file>]
```

Start with the dry run. It needs no token and makes no requests. Both runs report counts by file and kind, ignored filenames, and the line numbers of malformed records. The summary never prints source rows or credentials. The real run reads `CATALOG_OPERATOR_TOKEN` securely from the environment and uses the same target rules as `smoke`. It sends all sightings before decisions, oldest day first and morning before evening within each pass. Sightings use the file's UTC day, not the item's publication date. Rows preserve known stars, YouTube views, and X likes and impressions (as post views). Missing measurements stay absent.

`--concurrency <n>` sets how many items can have requests in flight at once. It defaults to 8 and accepts integers of at least 1. A file drains before the next starts, and commands for each item run one at a time in source order. The default has not been measured against production. Use `--concurrency 1` for serial delivery if the Api is under pressure.

Retry with the same filenames and line positions. Domain deduplicates command IDs derived from those coordinates within each item. Keep input files immutable once imported; renaming or reordering a file changes its command IDs. `ItemHistory` exposes event positions, not applied command IDs. To avoid resending a confirmed prefix, pass `--from <file>` with the exact filename of the first incomplete file. The start is inclusive, follows import order (not filename order), and works with `--dry-run` to check the proposed `skippedFiles` before sending. If you cannot verify which files completed, omit `--from` and replay safely.

Group keys never reach the Api. An unseen decision is tallied and does not stop the run. A failed command defers later commands for the same item. An unreadable file or unexpected defect stops the run. These failures exit nonzero and print a partial summary with `firstIncompleteFile`. Parsed command counts can include rows not yet sent. Requests without a receipt may already have committed, so replay the entire incomplete file. A defect names the file and line when known, and prints a recognized error name and safe diagnostic. Unrecognized free-form messages and nested causes are withheld because they can contain request data.

`sent` counts receipts that advance past the history cursor or a receipt already seen in this run. `skippedDuplicates` counts receipts that do not advance it (cached receipts or accepted no-ops). If `ItemHistory` is behind, a replay may still show `sent`; the command IDs prevent extra events. Run this importer as the only writer to the items it touches.

## Index and query contract

- Rows are immutable event copies keyed by `stream:seq`. Identical replay is harmless; divergent `event_json` at that position fails loudly without overwriting the original.
- The D1 migration lives in `migrations/`; the owning `D1CatalogStore` Layer declares the database and binding.
- Production retains the database. Existing Item and ItemHistory resource identities do not change.
- Domain advances its checkpoint after the complete handler batch succeeds. A crash between writes and that checkpoint replays the same row identities. Permanent invalid input is durably recorded in `catalog_quarantine` with its source position and reason; quarantine failure keeps the checkpoint held.
- Queries use an explicit half-open observation-time window, up to 30 days. They default to 50 output rows and cap pages at 200.
- Rising compares known measurements from the same source, ranks positive absolute gain, and returns the strongest source per item.
- Rising rows carry measured counts, relative gain, times, and the latest indexed editorial decision. A zero baseline has null relative gain.
- RepeatAuthors counts N distinct canonical URLs per `(source, lowercased handle)`. `RecordSighting` lowercases new handles; the index also normalizes historical handles. Output includes the source. Up to 500 exclusions use `{ source, author }`; handle comparison is case-insensitive. Automatic admission exclusion waits for Person.
- Receipt `atLeast` waits for the relevant indexed streams, not a global catalog snapshot. Results can change between pages.

Time-range indexes bound the scanned history interval, not its density. The SQL still groups and sorts matching observations before returning a keyset page. The exclusions use one JSON parameter instead of one bind parameter per handle.

## Runtime and recovery boundaries

The migration URL is computed only inside deploy-time resource props. Database retention comes from the enclosing production Worker scope. The adapter retains the SDK's `RuntimeContext.phantom` empty layer because native D1 operations declare that compile-time requirement; it does not capture deployment services into the runtime context.

Domain delivery batches cap at 25 rows. Permanent refusal plus quarantine uses at most two D1 calls per row in that handler batch. Native drain may process multiple batches in one invocation; invocation exhaustion remains a transient failure and a later alarm resumes from the durable checkpoint. Direct store batches are chunked at 25 statements. Cloudflare documents a batch call as one query against the invocation limit, regardless of statement count.

Watch quarantined source positions, D1 rows read and query duration. Window density remains unbounded; a rollup comes later. Decision ordering assumes one stream per canonical item. Observation ties use numeric sequence before text id. Multiple streams or a reset require an epoch or reconciliation. A corrupt result row deliberately fails the whole query.

## Checks

`pnpm --filter @rat-stack/catalog-server test` runs native Api and smoke tests plus the same store properties against memory and the D1 SQL adapter on SQLite. It covers replay, window boundaries, missing metrics, ordering, pagination, typed failures, rollback, and query-plan index access. `apps/infra/test/catalog-binding.test.ts` checks optional secret declarations, redacted wire round-trip, and the retained database declaration without provider calls.

The suite includes the actual bundled `CatalogWorker` in local workerd with D1 through `@alchemy.run/test`. `pnpm --filter @rat-stack/site startup:check` reports its static startup set and upload size.

Local SQLite, local workerd and declaration checks do not prove deployed D1 behavior or a production resource diff. The owner must review `pnpm infra:plan` and run the live smoke after deployment.
