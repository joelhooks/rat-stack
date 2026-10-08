# Basin erasure proof

This proof uses five temporary resources. It does not change the production Stack.

## Run

1. Install workspace dependencies with the pinned pnpm version.
2. Choose a new 32-character lowercase hexadecimal `BASIN_PROOF_RUN_ID` when scoping a token in advance.
3. Provide `BASIN_PROOF_TOKEN` through the approved secret resolver. Scope it to `rat-stack-erasure-proof-<run-id>`. Do not put it in a command argument.
4. Use the existing `ratstack` Alchemy profile. Remove provider credential overrides from the environment.
5. Choose positive observation bounds. No cloud maintenance latency baseline is established yet.
6. Run the script from the repository root:

```sh
uv run --script apps/infra/scripts/proofs/basin-erasure.py \
  --profile ratstack \
  --deadline-seconds <observation-deadline> \
  --poll-seconds <observation-interval> \
  --snapshot-age-seconds <throwaway-snapshot-age>
```

Replace the three placeholders with positive integers. The interval and snapshot age must each be less than the deadline.

The launcher generates a run ID only when `BASIN_PROOF_RUN_ID` is unset. A supplied ID lets the operator scope the token before creation. It uses stack `BasinErasureProof` and stage `proof-<run-id>`. The stage refuses other names. Its bucket name includes the run ID.

The native create plan must contain exactly these five creates:

- `ErasureProofBucket`
- `ErasureProofStream`
- `ErasureProofCatalog`
- `ErasureProofSink`
- `ErasureProofPipeline`

The controller refuses other actions, bindings, resources, and state-store bootstrap. It applies the same approved native plan. It does not parse terminal plan text.

## What the proof checks

- PyIceberg writes three synthetic rows into `default.intake_raw`: one applicant's contact and statement, plus a second applicant's contact.
- All three rows start in the same small Parquet write.
- A row-delete transaction removes both rows for the target and preserves the other applicant.
- The old Parquet objects still exist immediately after deletion.
- The script then enables Cloudflare-managed snapshot expiration, retaining the current snapshot.
- It waits for every original snapshot to expire and every original Parquet object to disappear.
- It reads the survivor again and checks its current data files.
- Only then can the proof pass.

PyIceberg 0.12.0 expires snapshot metadata without deleting the old Parquet objects. The proof therefore uses Cloudflare maintenance for physical cleanup. It never manually deletes an object to make the proof pass.

After the check, the controller destroys only the original approved resource set. The temporary bucket allows forced emptying during this final teardown. Teardown also runs after a typed creation or proof failure. A teardown failure remains a failure. A process crash can leave resources. Inspect the private receipt before any recovery operation.

## Output and recovery

Standard output contains one JSON object with numeric counts:

- `resourcesCreated` and `resourcesDestroyed`
- `rowsWritten` and `rowsRemaining`
- `snapshotsExpired` and `parquetGone`
- `failures`

A successful run exits zero, creates and destroys five resources, writes three rows, and leaves one survivor before teardown. It must report at least one expired snapshot and one removed Parquet object, with zero failures. Successful proof counts come from observed operations. Configuration alone does not establish success. On proof failure, zero proof counts mean no qualified result. They do not establish that no writes occurred.

Private recovery receipts live in `.rat/proofs/<run-id>.json`. They record the target and final counts, without secret values. If the process crashes, use the receipt's exact stage and the same entrypoint for a read-only destroy plan. Do not run a production destroy or guess a stage.

A catalog authorization failure prints this fixed message on standard error:

> R2 Data Catalog REST token requires Workers R2 Data Catalog Read and Write plus Workers R2 Storage Bucket Item Read and Write, scoped to the throwaway bucket.

Cloudflare calls this **Admin Read & Write** in the R2 token UI. The proof does not mint or broaden a token. Provider credentials remain profile-only.

## Limits

The synthetic rows are written by PyIceberg. Stream HTTP ingestion stays disabled. This proves the catalog deletion and physical cleanup mechanism, not production ingestion or the applicant-vault cascade. Production wiring and erasure integration remain separate work. No applicant erasure promise is qualified until the live proof and that integration pass.

## Sources

- [Cloudflare: deleting data](https://developers.cloudflare.com/basin-catalog/deleting-data/)
- [Cloudflare: table maintenance](https://developers.cloudflare.com/basin-catalog/table-maintenance/)
- [Cloudflare: engine permissions](https://developers.cloudflare.com/basin-catalog/manage-catalogs/#authenticate-your-iceberg-engine)
- [PyIceberg 0.12.0 snapshot expiration source](https://github.com/apache/iceberg-python/blob/pyiceberg-0.12.0/pyiceberg/table/update/snapshot.py)

The inline script pins PyIceberg 0.12.0 and PyArrow 25.0.1. Neither is an application dependency.
