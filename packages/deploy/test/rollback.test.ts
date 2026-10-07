import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Ref, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";

import { ReceiptStore } from "../src/receipt-store.js";
import { RollbackRunner } from "../src/rollback-runner.js";
import { WorkerDeployments } from "../src/worker-deployments.js";

it.effect.prop(
  "repeated recovery preserves its source and does not redeploy an already restored version",
  {
    alreadyCurrent: Schema.Boolean,
  },
  ({ alreadyCurrent }) =>
    Effect.gen(function* testRecovery() {
      const current = yield* Ref.make(alreadyCurrent ? "prior" : "new");
      const deployments: string[] = [];

      const source = {
        path: "apply.json",
        profile: "fixture",
        receipt: {
          notUpdated: [],
          outcome: "applied",
          previousVersions: { worker: "prior" },
          profile: "fixture",
          retainedOrphans: [],
          updated: ["worker"],
          versions: { worker: "new" },
        },
      } satisfies Parameters<RollbackRunner["Service"]["restore"]>[0];

      const stores = ReceiptStore.of({
        readApply: () => Effect.succeed(source),
        saveApply: () => Effect.die("rollback-must-not-overwrite-apply"),
        saveRollback: () => Effect.succeed("rollback.json"),
      });

      const provider = WorkerDeployments.of({
        forProfile: () =>
          Effect.succeed({
            current: () => Ref.get(current).pipe(Effect.map(Option.some)),
            restore: (_worker, version) =>
              Effect.sync(() => deployments.push(version)).pipe(
                Effect.andThen(Ref.set(current, version))
              ),
          }),
      });

      const runner = yield* RollbackRunner.pipe(
        Effect.provide(
          RollbackRunner.layer("https://example.test").pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ReceiptStore, stores),
                Layer.succeed(WorkerDeployments, provider),
                Layer.succeed(
                  HttpClient.HttpClient,
                  HttpClient.make(() => Effect.die("no-network-during-restore"))
                )
              )
            )
          )
        )
      );

      const first = yield* runner.restore(source);
      const second = yield* runner.restore(source);

      expect(first.versions).toStrictEqual({ worker: "prior" });
      expect(second.versions).toStrictEqual(first.versions);
      expect(deployments).toStrictEqual(alreadyCurrent ? [] : ["prior"]);
      expect(source.receipt.versions).toStrictEqual({ worker: "new" });
    }),
  { arbitrary: { runs: 20 } }
);

it.layer(NodeServices.layer)("receipt boundaries", (test) => {
  test.effect(
    "missing and malformed apply receipts refuse before a recovery target exists",
    () =>
      Effect.gen(function* receiptBoundary() {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectory();

        const store = yield* ReceiptStore.pipe(
          Effect.provide(ReceiptStore.layer(directory))
        );

        const missing = yield* store.readApply("fixture").pipe(Effect.result);

        expect(missing._tag).toBe("Failure");
        yield* fs.makeDirectory(`${directory}/fixture`, { recursive: true });
        yield* fs.writeFileString(
          `${directory}/fixture/last-apply.json`,
          "{bad"
        );
        const malformed = yield* store.readApply("fixture").pipe(Effect.result);

        expect(malformed._tag).toBe("Failure");
        yield* fs.remove(directory, { recursive: true });
      })
  );
});
