import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { expect } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import * as SecureRandom from "effect/crypto/SecureRandom";
import { HttpClient, HttpClientRequest } from "effect/http";

import { JOIN_CONTACT_KEY } from "../src/interest/join-contact-cell.js";
import { localServices } from "./fixtures/flag-ledger-client.js";
import { durableObjectStorage } from "./fixtures/local-storage.js";
import RetentionBackfillWorker from "./fixtures/retention-backfill-worker.js";
import { deployScratch } from "./fixtures/scratch-deploy.js";

const { test } = Test.make({
  dev: true,
  providers: Cloudflare.providers(),
  sidecar: false,
  stage: `retention_preview_runtime_${process.pid}`,
});

const SeedRows = Schema.Array(
  Schema.Struct({ id: Schema.String, sealed: Schema.String })
);

test.provider(
  "oldest raw and wrapped legacy rows preview through real Worker RPCs and storage defects remain typed operator failures",
  (stack) =>
    Effect.gen(function* legacyPreview() {
      const worker = yield* deployScratch(stack, RetentionBackfillWorker);
      const url = yield* Effect.fromNullishOr(worker.url).pipe(Effect.orDie);
      const random = yield* SecureRandom.SecureRandom;
      const prefix = yield* random.uuidV4();

      const response = yield* HttpClient.post(
        new URL(`/seed?prefix=${prefix}`, url)
      );

      expect(response.status).toBe(200);

      const rows = yield* response.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(SeedRows))
      );

      for (const [index, row] of rows.entries()) {
        const storage = yield* durableObjectStorage(
          "Interest",
          `intake-statement:${row.id}`
        );

        yield* storage.write(
          JOIN_CONTACT_KEY,
          index === 1 ? { sealed: row.sealed, erase: false } : row.sealed
        );
        yield* storage.remove("join-contact-meta");
        yield* storage.remove("join-erase-request");
      }

      const client = yield* HttpClient.HttpClient;

      const preview = (fault = false) =>
        Effect.gen(function* previewPage() {
          const request = yield* HttpClientRequest.post(
            new URL(
              `/operator/interest/applications/retention-backfill?prefix=${prefix}${fault ? "&fault=1" : ""}`,
              url
            )
          ).pipe(
            HttpClientRequest.setHeader(
              "authorization",
              "Bearer synthetic-operator"
            ),
            HttpClientRequest.bodyJson({ apply: false, limit: 25 })
          );

          const result = yield* client.execute(request);

          return { status: result.status, text: yield* result.text };
        });

      const healthy = yield* preview();
      expect(healthy.status, healthy.text).toBe(200);

      expect(
        yield* Schema.decodeEffect(
          Schema.fromJsonString(
            Schema.Struct({ pending: Schema.Int, gone: Schema.Int })
          )
        )(healthy.text)
      ).toEqual({ pending: 2, gone: 1 });
      const oldest = rows.find((row) => row.id.endsWith("-synthetic-fault"));
      expect(oldest).toBeDefined();

      if (oldest === undefined) {
        return;
      }

      const storage = yield* durableObjectStorage(
        "Interest",
        `intake-statement:${oldest.id}`
      );

      const failure = yield* Effect.gen(function* failLegacyRead() {
        yield* storage.rejectReads;

        return yield* preview(true);
      }).pipe(Effect.scoped);

      expect(failure).toEqual({
        status: 503,
        text: "Applications unavailable.\n",
      });
      expect((yield* preview(true)).status).toBe(200);
      expect(yield* storage.read(JOIN_CONTACT_KEY)).toEqual(
        Option.some(oldest.sealed)
      );
    }).pipe(Effect.scoped, Effect.provide(localServices)),
  { timeout: 120_000 }
);
