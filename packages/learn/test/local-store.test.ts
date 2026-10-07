import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { LearnerProgress, emptyProgress } from "@rat-stack/core/learn";
import type { Card, LearnEvent } from "@rat-stack/core/learn";
import { ConfigProvider, Effect, FileSystem, Layer, Path } from "effect";

import { Learner } from "../src/learner.js";
import { localLearnerProgressLayer } from "../src/local-store.js";

const card: Card = {
  claim: "Services name jobs",
  id: "lore.services",
  kind: "lore",
  prerequisites: [],
  references: ["https://ratstack.sh/lore/services"],
  routePath: "/lore/services",
  summary: "Services name application jobs.",
  terms: ["service"],
  version: 1,
};

const event: LearnEvent = {
  at: 100,
  depth: "walkthrough",
  id: card.id,
  kind: "shown",
  version: 1,
};

it.effect(
  "local capabilities append once, rebuild corrupted copies, and reject a damaged source without writing",
  () =>
    Effect.gen(function* localHistory() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped();

      const layer = localLearnerProgressLayer(directory).pipe(
        Layer.provide(Learner.layer(Effect.succeed([card])))
      );

      yield* Effect.gen(function* exerciseStore() {
        const store = yield* LearnerProgress;
        const first = yield* store.next({ at: 100, ids: [card.id] });
        expect(first.cards[0]?.depth).toBe("walkthrough");
        expect(first.progress).toStrictEqual(emptyProgress);
        const result = yield* store.record(event);
        const repeated = yield* store.record(event);
        expect(repeated).toStrictEqual(result);

        const source = yield* fs.readFileString(
          path.join(directory, "log.jsonl")
        );

        expect(source.trim().split("\n")).toHaveLength(1);
        expect(result.concepts[0]?.familiarity).toBe(1);
        yield* fs.writeFileString(
          path.join(directory, "cards.jsonl"),
          "bad derived copy"
        );
        const read = yield* store.read;
        expect(read).toStrictEqual(result);
        expect(
          yield* fs.readFileString(path.join(directory, "cards.jsonl"))
        ).not.toContain("bad derived copy");
        yield* fs.writeFileString(
          path.join(directory, "log.jsonl"),
          `${source}{incomplete`
        );
        const error = yield* store.record(event).pipe(Effect.flip);
        expect(error.operation).toBe("record");
        expect(
          yield* fs.readFileString(path.join(directory, "log.jsonl"))
        ).toBe(`${source}{incomplete`);
        expect(yield* fs.exists(path.join(directory, "writer.lock"))).toBe(
          false
        );
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({ RAT_LEARN_DIRECTORY: directory })
        )
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
