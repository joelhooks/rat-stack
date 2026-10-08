import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import { destroy } from "alchemy/RemovalPolicy";
import { Config, Effect, Schema } from "effect";

export const ProofRunIdSchema = Schema.String.check(
  Schema.isPattern(/^[a-f0-9]{32}$/u)
);

export const basinProofResources = Effect.gen(function* basinProofResources() {
  const runId = yield* Config.schema(ProofRunIdSchema, "BASIN_PROOF_RUN_ID");
  const stage = yield* Alchemy.Stage;

  if (stage !== `proof-${runId}`) {
    return yield* Effect.die("basin-proof-stage-mismatch");
  }

  const token = yield* Config.Redacted("BASIN_PROOF_TOKEN");

  const bucket = yield* Cloudflare.R2.Bucket("ErasureProofBucket", {
    forceDestroy: true,
    name: `rat-stack-erasure-proof-${runId}`,
  }).pipe(destroy());

  const stream = yield* Cloudflare.Pipelines.Stream("ErasureProofStream", {
    http: { enabled: false },
  }).pipe(destroy());

  const catalog = yield* Cloudflare.R2.DataCatalog("ErasureProofCatalog", {
    bucketName: bucket.bucketName,
    compaction: { state: "disabled" },
    snapshotExpiration: { state: "disabled" },
    token,
  }).pipe(destroy());

  const sink = yield* Cloudflare.Pipelines.Sink("ErasureProofSink", {
    config: {
      bucket: catalog.bucketName,
      namespace: "default",
      tableName: "intake_raw",
      token,
    },
    format: { compression: "zstd", type: "parquet" },
    type: "r2_data_catalog",
  }).pipe(destroy());

  yield* Cloudflare.Pipelines.Pipeline("ErasureProofPipeline", {
    sql: Output.interpolate`INSERT INTO ${sink.name} SELECT * FROM ${stream.name}`,
  }).pipe(destroy());

  return {
    accountId: catalog.accountId,
    bucket: catalog.bucketName,
    uri: catalog.catalogUri,
    warehouse: catalog.name,
  };
});

export default Alchemy.Stack(
  "BasinErasureProof",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  basinProofResources
);
