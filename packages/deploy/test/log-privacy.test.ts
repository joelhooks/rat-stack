import { inspect } from "node:util";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, FileSystem, Logger } from "effect";
import * as HttpClient from "effect/http/HttpClient";

import { postDeployChecks } from "../src/checks.js";
import { validateDeployInputs } from "../src/inputs.js";
import { ReceiptStore } from "../src/receipt-store.js";

const secret = "planted-log-credential-829b";

const capture = (messages: unknown[]) =>
  Logger.make(({ message }) => {
    messages.push(
      inspect(message, { depth: null, customInspect: false, showHidden: true })
    );
  });

const check = {
  check: secret,
  counts: { [secret]: -1 },
  observedAt: 0,
  reason: secret,
  control: 0,
  exitCode: 1,
  outcome: "failed" as const,
  status: "red" as const,
};

const apply = {
  versionReadbacks: [check],
  appliedAt: 0,
  notUpdated: [],
  outcome: "applied" as const,
  retainedOrphans: [],
  updated: [],
  versions: {},
};

const rollback = {
  checks: [check],
  completed: [],
  observedAt: 0,
  operation: "rollback" as const,
  outcome: "failed" as const,
  profile: secret,
  source: { path: "apply.json", profile: secret, receipt: apply },
  targets: {},
  versions: {},
};

it.layer(NodeServices.layer)("deploy log boundaries", (test) => {
  const sites = [
    {
      name: "apply receipt encoding",
      run: (store: ReceiptStore["Service"]) => store.saveApply(secret, apply),
    },
    {
      name: "rollback receipt encoding",
      run: (store: ReceiptStore["Service"]) => store.saveRollback(rollback),
    },
    {
      name: "verdict encoding",
      run: (store: ReceiptStore["Service"]) =>
        store.saveVerdict(secret, {
          checks: [],
          keys: [],
          outcome: "failed",
          rows: [],
          step: secret,
          receipt: { ...apply, profile: secret },
        }),
    },
    {
      name: "watch receipt encoding",
      run: (store: ReceiptStore["Service"]) =>
        store.saveWatch({
          operation: "post-deploy-watch",
          outcome: "rollback-failed",
          profile: secret,
          reason: secret,
          rollback,
        }),
    },
    {
      name: "receipt write",
      run: (store: ReceiptStore["Service"]) =>
        store.saveApply(secret, { ...apply, versionReadbacks: [] }),
    },
  ];

  for (const site of sites) {
    test.effect(`${site.name} logs only safe diagnostics`, () =>
      Effect.gen(function* loggedFailure() {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        const blocked = `${directory}/not-a-directory`;
        yield* fs.writeFileString(blocked, "fixture");

        const store = yield* ReceiptStore.pipe(
          Effect.provide(ReceiptStore.layer(blocked))
        );

        const messages: unknown[] = [];

        const failure = yield* site
          .run(store)
          .pipe(Effect.flip, Effect.provide(Logger.layer([capture(messages)])));

        expect(failure._tag).toBe("DeployStepError");
        expect(messages).toHaveLength(1);
        expect(JSON.stringify(messages)).not.toContain(secret);
        expect(JSON.stringify(messages)).toContain("reason");
      })
    );
  }
});

for (const site of ["inputs", "checks"]) {
  it.effect(`${site} never logs invalid credential-bearing config values`, () =>
    Effect.gen(function* configFailure() {
      const messages: unknown[] = [];

      const operation =
        site === "inputs"
          ? validateDeployInputs(
              "# @required=forEnv(production)\nALCHEMY_PROFILE="
            )
          : postDeployChecks("https://example.test", "generation", 0);

      const failure = yield* Effect.gen(function* request() {
        return yield* operation;
      }).pipe(
        Effect.flip,
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({
            env: {
              ALCHEMY_PROFILE: secret,
              EVENTS_ENABLED: secret,
              DEPLOY_CONTENT_VERSION_DEADLINE_MS: secret,
            },
          })
        ),
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("no-network"))
        ),
        Effect.provide(Logger.layer([capture(messages)]))
      );

      expect(failure._tag).toBe("DeployStepError");
      expect(messages).toHaveLength(1);
      expect(JSON.stringify(messages)).not.toContain(secret);
    })
  );
}
