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

The command reads `CATALOG_OPERATOR_TOKEN` from its environment through Effect Config. It calls native `OperatorApi.clientHttp(...).ItemHistory.get` first without credentials, expecting typed Unauthorized. It then calls with the token, accepting a successful read or a missing-item result. The URL must use HTTP or HTTPS and contain no embedded credentials. Failures exit nonzero with a sanitized phase; neither HTTP errors nor token values are printed. The probe has an initial 30-second total deadline through `smokeDeadline`, a Context.Reference. A timeout leaves the target unverified; it does not claim an authentication rejection.

A raw GET is not an auth or health check. The pinned native RPC server accepts an empty NDJSON request without dispatching a model operation and returns an empty 200 response. No extra GET guard is installed because WebSocket reads legitimately use GET.

## Index and query contract

- Rows are immutable event copies keyed by `stream:seq`. A replay leaves an existing row unchanged.
- The D1 migration lives in `migrations/`; the owning `D1CatalogStore` Layer declares the database and binding.
- Production retains the database. Existing Item and ItemHistory resource identities do not change.
- Domain advances its projection checkpoint after a successful D1 batch. A crash between these commits replays the same row identities.
- Queries use an explicit half-open observation-time window, up to 30 days. They default to 50 output rows and cap pages at 200.
- Rising compares known measurements from the same source, ranks positive absolute gain, and returns the strongest source per item.
- Rising rows carry measured counts, relative gain, times, and the latest indexed editorial decision. A zero baseline has null relative gain.
- RepeatAuthors counts distinct canonical URLs per exact handle and accepts up to 500 explicit exclusions. Automatic admission exclusion waits for Person.
- Receipt `atLeast` waits for the relevant indexed streams, not a global catalog snapshot. Results can change between pages.

Time-range indexes bound the scanned history interval, not its density. The SQL still groups and sorts matching observations before returning a keyset page. The exclusions use one JSON parameter instead of one bind parameter per handle.

## Checks

`pnpm --filter @rat-stack/catalog-server test` runs native Api and smoke tests plus the same store properties against memory and the D1 SQL adapter on SQLite. It covers replay, window boundaries, missing metrics, ordering, pagination, typed failures, rollback, and query-plan index access. `apps/infra/test/catalog-binding.test.ts` checks optional secret declarations, redacted wire round-trip, and the retained database declaration without provider calls.

Local SQLite and declaration checks do not prove deployed D1 behavior or a production resource diff. The owner must review `pnpm infra:plan` and run the live smoke after deployment.
