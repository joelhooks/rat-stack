import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Output from "alchemy/Output";
import "alchemy/Phase";
import { retain } from "alchemy/RemovalPolicy";
import { Config, ConfigProvider, Effect } from "effect";

export const basinStream = (name: string) =>
  Effect.gen(function* declareBasinStream() {
    const bucket = yield* Cloudflare.R2.Bucket(`${name}Bucket`, {}).pipe(
      retain()
    );

    const stream = yield* Cloudflare.Pipelines.Stream(`${name}Stream`, {
      http: { enabled: false },
    }).pipe(retain());

    return { bucket, stream } as const;
  });

const sinkToken = Config.Redacted("EVENTS_SINK_TOKEN").pipe(
  Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv())
);

export type CatalogMaintenance = Pick<
  Cloudflare.R2.DataCatalogProps,
  "compaction" | "snapshotExpiration"
>;

export interface IcebergSinkOptions {
  readonly bucketName: Output.Output<string>;
  readonly maintenance?: CatalogMaintenance;
  readonly name: string;
  readonly streamName: Output.Output<string>;
  readonly table: string;
}

export const icebergSink = ({
  bucketName,
  maintenance = {},
  name,
  streamName,
  table,
}: IcebergSinkOptions) =>
  Effect.gen(function* declareIcebergSink() {
    const token = yield* sinkToken;

    const catalog = yield* Cloudflare.R2.DataCatalog(`${name}Catalog`, {
      ...maintenance,
      bucketName,
      token,
    }).pipe(retain());

    const sink = yield* Cloudflare.Pipelines.Sink(`${name}Sink`, {
      config: {
        bucket: catalog.bucketName,
        namespace: "default",
        tableName: table,
        token,
      },
      format: { compression: "zstd", type: "parquet" },
      type: "r2_data_catalog",
    }).pipe(retain());

    return yield* Cloudflare.Pipelines.Pipeline(`${name}Pipeline`, {
      sql: Output.interpolate`INSERT INTO ${sink.name} SELECT * FROM ${streamName}`,
    }).pipe(retain());
  });
