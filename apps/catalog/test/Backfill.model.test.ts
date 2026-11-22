import * as Domain from "@alchemy.run/domain";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Catalog, CatalogHandlers } from "@rat-stack/catalog/Catalog.model";
import { CatalogMemory } from "@rat-stack/catalog/Catalog/CatalogMemory";
import { ItemId } from "@rat-stack/catalog/Item/Item.id";
import { OperatorApi } from "@rat-stack/catalog/OperatorApi.api";
import {
  Arbitrary,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Predicate,
  Redacted,
  Schema,
} from "effect";

import {
  backfillFiles,
  listBackfillInputs,
  backfillSender,
} from "../src/Backfill.ts";
import { operatorTokenLayer } from "../src/OperatorToken.ts";

const token = Redacted.make("synthetic-backfill-token");

const headers = { authorization: "Bearer synthetic-backfill-token" };

const world = operatorTokenLayer(Option.some(token)).pipe(
  Layer.provideMerge(
    Catalog.layer(CatalogHandlers.pipe(Layer.provide(CatalogMemory)))
  ),
  Layer.provide(Domain.InMemory)
);

const repo = "synthetic-org/synthetic-repo";

const item = ItemId.make(`https://github.com/${repo}`);

const otherRepo = "synthetic-org/other-repo";

const starsPerDay = Schema.Array(
  Schema.Natural.check(Schema.isLessThan(1000))
).check(Schema.isMinLength(1), Schema.isMaxLength(4));

const lines = (rows: readonly object[]) =>
  rows.map((row) => JSON.stringify(row)).join("\r\n");

it.live.prop(
  "imports shuffled daily files in source order and replays the same commands without adding events",
  { starsPerDay: Arbitrary.schema(starsPerDay) },
  ({ starsPerDay: stars }) =>
    Effect.gen(function* replayBackfill() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped();

      const write = (name: string, body: string) =>
        fs.writeFileString(path.join(dir, name), body);

      for (const [index, count] of [...stars.entries()].toReversed()) {
        const day = `2026-01-0${index + 1}`;
        yield* write(
          `${day}-pm-decisions.jsonl`,
          lines([
            {
              id: item,
              source: "github",
              decision: "dropped",
              why: "Synthetic drop",
            },
          ])
        );
        yield* write(
          `${day}-pm-github.jsonl`,
          lines([{ kind: "github", repo, stars: count + 1 }])
        );
        yield* write(
          `${day}-decisions.jsonl`,
          lines([
            {
              id: `monitor:synthetic-${index}`,
              source: "github",
              decision: "kept",
              why: "Synthetic group",
            },
            {
              id: `https://example.test/unseen-${index}`,
              source: "github",
              decision: "kept",
              why: "Synthetic unseen",
            },
            {
              id: item,
              source: "github",
              decision: "kept",
              why: "Synthetic keep",
            },
          ])
        );
        yield* write(
          `${day}-github.jsonl`,
          `invalid json\r\n${lines([
            { kind: "github", repo, stars: count },
            { kind: "github", repo: otherRepo, stars: count + 1 },
          ])}\r\n`
        );
      }

      yield* write("2026-02-30-x.jsonl", "ignored");
      yield* write("2026-01-01-crawl.err", "ignored");
      yield* fs.makeDirectory(path.join(dir, "2026-01-01-youtube.jsonl"));

      const inputs = yield* listBackfillInputs(dir);
      const preview = yield* backfillFiles(dir, inputs);
      const api = yield* OperatorApi.clientInProcess;

      const first = yield* backfillFiles(dir, inputs, {
        concurrency: 3,
        send: backfillSender(api, token),
      });

      const days = stars.length;
      expect(preview.delivery).toBeUndefined();
      expect(preview.files).toEqual(first.files);
      expect(preview.ignoredFiles).toEqual([
        "2026-01-01-crawl.err",
        "2026-01-01-youtube.jsonl",
        "2026-02-30-x.jsonl",
      ]);
      expect(
        preview.files
          .map(({ malformedLines }) => malformedLines)
          .filter((bad) => bad.length > 0)
      ).toEqual(stars.map(() => [1]));
      expect(preview.files.reduce((n, file) => n + file.groupKeys, 0)).toBe(
        days
      );
      expect(first.delivery).toEqual({
        sent: days * 4,
        skippedDuplicates: days,
        unseen: days,
        failed: 0,
        failedCommands: [],
      });

      const atLeast = { stream: `Item/${item}`, version: days * 3 };

      const order = {
        headers,
        atLeast,
        order: "asc",
        take: days * 5,
      } satisfies Parameters<typeof api.ItemHistory.list>[1];

      const before = yield* api.ItemHistory.list(item, order);
      expect(before.entries.map(({ event }) => event._tag)).toEqual([
        ...stars.map(() => "SightingRecorded"),
        ...stars.flatMap(() => ["ItemKept", "ItemDropped"]),
      ]);
      expect(
        before.entries.flatMap(({ event }) =>
          Predicate.isTagged(event, "SightingRecorded")
            ? [event.metrics.stars]
            : []
        )
      ).toEqual(stars);

      const replay = yield* backfillFiles(dir, inputs, {
        concurrency: 3,
        send: backfillSender(api, token),
      });

      expect(replay.delivery).toEqual({
        sent: 0,
        skippedDuplicates: days * 5,
        unseen: days,
        failed: 0,
        failedCommands: [],
      });
      expect(yield* api.ItemHistory.list(item, order)).toEqual(before);
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(world, NodeServices.layer))
    ),
  { arbitrary: { runs: 25 } }
);
