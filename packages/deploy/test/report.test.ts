import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";

import { deployReport, DeployVerdictSchema } from "../src/contracts.js";
import type { DeployVerdict } from "../src/contracts.js";
import { ReceiptStore } from "../src/receipt-store.js";

const Provenance = Schema.Struct({
  fetchedAt: Schema.Natural,
  id: Schema.NonEmptyString,
  source: Schema.NonEmptyString,
  status: Schema.NonEmptyString,
});

const watchedVerdict = (
  provenance: readonly (typeof Provenance.Type)[]
): DeployVerdict => ({
  checks: [
    {
      check: "post-deploy-watch",
      control: 1,
      counts: { nonOk: 3 },
      exitCode: 2,
      observedAt: 1,
      outcome: "failed",
      provenance,
      reason: "WatchFailed:non-200-or-incomplete-watch",
      status: "red",
    },
  ],
  keys: [],
  outcome: "failed",
  receipt: {
    notUpdated: [],
    outcome: "applied",
    profile: "fixture",
    retainedOrphans: [],
    updated: ["worker"],
    versions: { worker: "new" },
  },
  rows: [],
  step: "checks",
});

it.prop(
  "the printed report does not grow with the evidence",
  { provenance: Schema.Array(Provenance).check(Schema.isMaxLength(20)) },
  ({ provenance }) => {
    expect(
      deployReport("fixture", watchedVerdict(provenance), "/v.json")
    ).toStrictEqual(deployReport("fixture", watchedVerdict([]), "/v.json"));
  }
);

it.layer(NodeServices.layer)("verdict file", (test) => {
  test.effect.prop(
    "the saved verdict reads back unchanged and points at its own file",
    { provenance: Schema.Array(Provenance).check(Schema.isMaxLength(5)) },
    ({ provenance }) =>
      Effect.gen(function* savedVerdict() {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectory();

        const store = yield* ReceiptStore.pipe(
          Effect.provide(ReceiptStore.layer(directory))
        );

        const verdict = watchedVerdict(provenance);
        const path = yield* store.saveVerdict("fixture", verdict);
        const report = deployReport("fixture", verdict, path);

        const saved = yield* fs
          .readFileString(path)
          .pipe(
            Effect.flatMap(
              Schema.decodeEffect(Schema.fromJsonString(DeployVerdictSchema))
            )
          );

        const latest = yield* fs.readFileString(
          `${directory}/fixture/last-verdict.json`
        );

        expect(saved).toEqual(verdict);
        expect(latest).toBe(yield* fs.readFileString(path));
        expect(report.verdictPath).toBe(path);
        expect(report.rollbackReceipt).toBe(
          ".rat/deploy/fixture/last-apply.json"
        );
        yield* fs.remove(directory, { recursive: true });
      }),
    { arbitrary: { runs: 10 } }
  );
});
