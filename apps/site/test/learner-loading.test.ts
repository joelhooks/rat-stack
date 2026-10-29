import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const Observation = Schema.Struct({
  characters: Schema.Finite,
  loads: Schema.Finite,
  status: Schema.Finite,
});

const Report = Schema.fromJsonString(
  Schema.Struct({
    learning: Observation,
    requests: Schema.Array(
      Schema.Struct({
        ...Observation.fields,
        accept: Schema.String,
        path: Schema.String,
      })
    ),
  })
);

it.effect(
  "serves home and news without loading Learner, then loads it for the first learning request",
  () =>
    Effect.gen(function* observeNativeModuleLoading() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const output = yield* spawner.string(
        ChildProcess.make("node", ["test/fixtures/learner-load-observer.mjs"])
      );

      const report = yield* Schema.decodeEffect(Report)(output);

      expect(report.requests).toHaveLength(4);

      for (const request of report.requests) {
        expect(request.status, `${request.path} ${request.accept}`).toBe(200);
        expect(request.characters).toBeGreaterThan(0);
        expect(request.loads).toBe(0);
      }

      expect(report.learning.status).toBe(200);
      expect(report.learning.characters).toBeGreaterThan(0);
      expect(report.learning.loads).toBe(1);
    }).pipe(Effect.provide(NodeServices.layer))
);
