import { Buffer } from "node:buffer";

import {
  apiTokenCredentials,
  Credentials,
  oauthCredentials,
} from "@distilled.cloud/cloudflare/Credentials";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import {
  Cause,
  Effect,
  FileSystem,
  Layer,
  Match,
  Redacted,
  Schema,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";

import { DeployStepError } from "../src/contracts.js";
import { ReceiptStore } from "../src/receipt-store.js";
import { RollbackRunner } from "../src/rollback-runner.js";
import { WorkerDeployments } from "../src/worker-deployments.js";

it.layer(NodeServices.layer)("receipt privacy", (test) => {
  test.effect.prop(
    "rollback strips credential-bearing upstream causes before pretty printing or writing receipts",
    { oauth: Schema.Boolean, token: Schema.NonEmptyString },
    ({ oauth, token }) => {
      const secret = `planted-credential:${Buffer.from(token).toString("hex")}:end`;

      const credential = oauth
        ? oauthCredentials({ accessToken: Redacted.make(secret) })
        : apiTokenCredentials({ apiToken: Redacted.make(secret) });

      return Effect.gen(function* credentialBoundary() {
        const configured = yield* Credentials;
        const resolved = yield* configured;

        const raw = Match.value(resolved).pipe(
          Match.when({ type: "oauth" }, (value) =>
            Redacted.value(value.accessToken)
          ),
          Match.when({ type: "apiToken" }, (value) =>
            Redacted.value(value.apiToken)
          ),
          Match.when({ type: "apiKey" }, (value) =>
            Redacted.value(value.apiKey)
          ),
          Match.exhaustive
        );

        const upstream = Object.assign(
          new DeployStepError({
            keys: [],
            reason: "profile-credential-unavailable",
            step: "preflight",
          }),
          { cause: new Error(raw) }
        );

        expect(Cause.pretty(Cause.fail(upstream))).toContain(secret);
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();

        const store = yield* ReceiptStore.pipe(
          Effect.provide(ReceiptStore.layer(directory))
        );

        const runner = yield* RollbackRunner.pipe(
          Effect.provide(
            RollbackRunner.layer("https://example.test").pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(ReceiptStore, store),
                  Layer.succeed(
                    WorkerDeployments,
                    WorkerDeployments.of({
                      forProfile: () => Effect.fail(upstream),
                    })
                  ),
                  Layer.succeed(
                    HttpClient.HttpClient,
                    HttpClient.make(() =>
                      Effect.die("no-network-during-refusal")
                    )
                  )
                )
              )
            )
          )
        );

        const source = {
          path: "apply.json",
          profile: "fixture",
          receipt: {
            notUpdated: [],
            outcome: "applied" as const,
            previousVersions: { worker: "old" },
            profile: "fixture",
            retainedOrphans: [],
            updated: ["worker"],
            versions: { worker: "new" },
          },
        };

        const failure = yield* runner.restore(source).pipe(Effect.flip);
        expect(Cause.pretty(Cause.fail(failure))).not.toContain(secret);

        const checkFailure = yield* runner
          .check(failure.receipt)
          .pipe(Effect.flip);

        expect(Cause.pretty(Cause.fail(checkFailure))).not.toContain(secret);

        const saved = yield* fs.readFileString(
          `${directory}/fixture/last-rollback.json`
        );

        expect(saved).not.toContain(secret);
        expect(saved).not.toContain('"cause"');
      }).pipe(Effect.provideService(Credentials, Effect.succeed(credential)));
    },
    { arbitrary: { runs: 10 } }
  );

  test.effect.prop(
    "persisted receipts exclude extra causes, including token-bearing step failures",
    { token: Schema.NonEmptyString },
    ({ token }) =>
      Effect.gen(function* savedReceipts() {
        const secret = `planted-token:${token}:end`;
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();

        const store = yield* ReceiptStore.pipe(
          Effect.provide(ReceiptStore.layer(directory))
        );

        const step = new DeployStepError({
          keys: ["ALCHEMY_PROFILE"],
          reason: "worker-deployment-read-refused",
          step: "checks",
        });

        const diagnostic = {
          cause: new Error(secret),
          keys: step.keys,
          reason: step.reason,
          step: step.step,
        };

        const apply = {
          cause: diagnostic,
          notUpdated: [],
          outcome: "applied" as const,
          previousVersions: { worker: "old" },
          profile: "fixture",
          retainedOrphans: [],
          updated: ["worker"],
          versions: { worker: "new" },
        };

        const rollback = {
          cause: diagnostic,
          checks: [],
          completed: [],
          observedAt: 1,
          operation: "rollback" as const,
          outcome: "failed" as const,
          profile: "fixture",
          source: {
            cause: diagnostic,
            path: "apply.json",
            profile: "fixture",
            receipt: apply,
          },
          targets: { worker: "old" },
          versions: {},
        };

        const verdictInput = {
          cause: diagnostic,
          checks: [],
          keys: step.keys,
          outcome: "failed" as const,
          reason: step.reason,
          rows: [],
          step: step.step,
          receipt: apply,
        };

        const watchInput = {
          cause: diagnostic,
          operation: "post-deploy-watch" as const,
          outcome: "rollback-failed" as const,
          profile: "fixture",
          reason: "fixed-reason",
          rollback,
        };

        const paths = [
          yield* store.saveApply("fixture", apply),
          yield* store.saveRollback(rollback),
          yield* store.saveVerdict("fixture", verdictInput),
          yield* store.saveWatch(watchInput),
        ];

        for (const path of paths) {
          const text = yield* fs.readFileString(path);
          expect(text).not.toContain(secret);
          expect(text).not.toContain('"cause"');
        }

        const verdict = yield* fs.readFileString(paths[2] ?? "missing-verdict");
        expect(verdict).toContain(step.reason);
        expect(verdict).toContain(step.step);
        expect(verdict).toContain("ALCHEMY_PROFILE");
      }),
    { arbitrary: { runs: 10 } }
  );
});
