import * as Cloudflare from "@alchemy.run/cloudflare";
import * as DomainCloudflare from "@alchemy.run/domain/Cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { expect } from "@effect/vitest";
import { backfillFile, decodeBackfillLine } from "@rat-stack/catalog/Backfill";
import { ItemId } from "@rat-stack/catalog/Item/Item.id";
import { OperatorApi } from "@rat-stack/catalog/OperatorApi.api";
import { ConfigProvider, DateTime, Effect, Layer } from "effect";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";

import { backfillSender } from "../src/Backfill.ts";
import CatalogWorker from "../src/CatalogWorker.ts";
import { smokeCatalog } from "../src/Smoke.ts";

const { test } = Test.make({
  dev: true,
  providers: Layer.mergeAll(
    Cloudflare.providers(),
    DomainCloudflare.providers()
  ),
  sidecar: false,
  stage: `catalog_boot_${process.pid}`,
});

const token = "synthetic-bundled-catalog-token";

test.provider(
  "the bundled CatalogWorker cold-boots, binds its optional secret and projects committed facts into local D1",
  (stack) =>
    Effect.gen(function* bootCatalogWorker() {
      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- ScratchStack erases provider errors; this local bundled-runtime boundary closes them with orDie.
      const worker = yield* stack.deploy(CatalogWorker).pipe(Effect.orDie);
      const url = yield* Effect.fromNullishOr(worker.url).pipe(Effect.orDie);
      yield* smokeCatalog(url, Redacted.make(token));
      const api = yield* OperatorApi.clientHttp(url);
      const item = ItemId.make("https://example.test/bundled-catalog");
      const options = { headers: { authorization: `Bearer ${token}` } };

      const first = yield* api.RecordSighting(
        item,
        {
          kind: "repo",
          source: "synthetic",
          author: "SYNTHETIC-BOOT",
          observedAt: DateTime.makeUnsafe("2026-01-02T00:00:00Z"),
          metrics: { stars: 0 },
        },
        options
      );

      const last = yield* api.RecordSighting(
        item,
        {
          kind: "repo",
          source: "synthetic",
          author: "Synthetic-Boot",
          observedAt: DateTime.makeUnsafe("2026-01-03T00:00:00Z"),
          metrics: { stars: 10 },
        },
        options
      );

      const history = yield* api.ItemHistory.get(item, {
        ...options,
        atLeast: last,
      });

      expect(history).toMatchObject({
        latestSighting: { author: "synthetic-boot" },
      });

      const window = {
        from: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
        until: DateTime.makeUnsafe("2026-01-04T00:00:00Z"),
      };

      const page = yield* api.Rising(
        { ...window, metric: "stars" },
        { ...options, atLeast: [first, last], take: 1 }
      );

      expect(page.entries.at(0)?.gain).toBe(10);

      const authors = yield* api.RepeatAuthors(
        { ...window, minimumItems: 1, excludedAuthors: [] },
        { ...options, atLeast: [first, last] }
      );

      expect(authors.entries).toEqual([
        { source: "synthetic", author: "synthetic-boot", items: 1 },
      ]);

      const file = backfillFile("2026-01-02-github.jsonl");

      if (file === null) {
        return yield* Effect.die(
          "Synthetic file must match the backfill schema"
        );
      }

      const decoded = decodeBackfillLine(
        file,
        1,
        '{"kind":"github","repo":"example/synthetic-worker","stars":17}'
      );

      if (decoded.tag !== "command") {
        return yield* Effect.die(
          "Synthetic row must map to a backfill command"
        );
      }

      const { command } = decoded;
      const send = backfillSender(api, Redacted.make(token));
      expect(yield* send(command)).toEqual(Result.succeed("sent"));

      const atLeast = { stream: `Item/${command.item}`, version: 1 };

      const snapshot = yield* api.ItemHistory.snapshot(command.item, {
        ...options,
        atLeast,
      });

      expect(snapshot.state?.latestSighting?.metrics.stars).toBe(17);

      const replay = backfillSender(api, Redacted.make(token));
      expect(yield* replay(command)).toEqual(
        Result.succeed("skippedDuplicates")
      );

      return yield* Effect.void;
    }).pipe(
      Effect.scoped,
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({ CATALOG_OPERATOR_TOKEN: token })
      )
    )
);
