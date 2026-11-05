import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { CredentialsUnavailable } from "alchemy/Auth/Resolve";
import * as Interaction from "alchemy/Interaction";
import * as Provisioning from "alchemy/State/Provisioning";
import {
  Cause,
  ConfigProvider,
  Effect,
  Layer,
  Redacted,
  Ref,
  Result,
  Schema,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { vi } from "vitest";

import {
  deployedCacheState,
  withoutStateProvisioning,
} from "../src/read-state.js";
import { stateReadFailure } from "../src/token-failure.js";
import { handoffToken } from "../src/token.js";

const token = "test-only-handoff-secret";

it.effect(
  "missing credentials name the required variable without blaming the store",
  () =>
    Effect.gen(function* missingCredentials() {
      const before = { ...process.env };

      const result = yield* deployedCacheState.pipe(
        Effect.catchCause((cause) => Effect.fail(stateReadFailure(cause))),
        Effect.result
      );

      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure.message).toContain("CredentialsUnavailable");
        expect(result.failure.message).toContain(
          "Missing required env: CLOUDFLARE_ACCOUNT_ID"
        );
        expect(result.failure.message).not.toContain(
          "unavailable or requires an upgrade"
        );
      }

      expect(
        Object.keys({ ...before, ...process.env }).filter(
          (key) => before[key] !== process.env[key]
        )
      ).toEqual([]);
    }).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make(() =>
          Effect.die("missing-credentials-must-not-reach-network")
        )
      ),
      Effect.provideService(AlchemyContext, {
        adopt: false,
        dev: false,
        dotAlchemy: ".alchemy",
        updateStateStore: true,
      }),
      Effect.provide(
        Interaction.layerNonInteractive().pipe(
          Layer.provideMerge(NodeServices.layer)
        )
      ),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({})
      )
    )
);

it.prop(
  "state failure diagnostics retain source fields without serializing credential data",
  { value: Schema.String },
  ({ value }) => {
    const failure = stateReadFailure(
      Cause.die(
        new CredentialsUnavailable({
          cause: { apiToken: `fixture-only-credential:${value}` },
          message: "Missing required env: CLOUDFLARE_API_TOKEN",
          provider: "Cloudflare",
        })
      )
    );

    expect(failure.message).toContain("CredentialsUnavailable");
    expect(failure.message).toContain(
      "Missing required env: CLOUDFLARE_API_TOKEN"
    );
    expect(JSON.stringify(failure)).not.toContain("fixture-only-credential:");
  }
);

const records = (fqn: string) =>
  Effect.succeed(
    fqn === "TurboCache"
      ? {
          attr: { url: "https://cache.example.test/" },
          status: "updated",
        }
      : {
          attr: { text: Redacted.make(token) },
          resourceType: "Alchemy.Random",
          status: "created",
        }
  );

it.effect(
  "sends a deployed token only through stdin and suppresses receiver output",
  () =>
    Effect.gen(function* stdinHandoff() {
      const stdout = vi.spyOn(process.stdout, "write");
      const stderr = vi.spyOn(process.stderr, "write");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          stdout.mockRestore();
          stderr.mockRestore();
        })
      );

      const values = yield* handoffToken(records, {
        args: [
          "-e",
          [
            "const crypto = require('node:crypto');",
            "let input = '';",
            "process.stdin.on('data', chunk => input += chunk);",
            "process.stdin.on('end', () => {",
            "const hash = crypto.createHash('sha256').update(input).digest('hex');",
            "process.stdout.write(input); process.stderr.write(input);",
            "const leaked = process.argv.some(arg => arg.includes(input)) || Object.values(process.env).includes(input);",
            "process.exit(hash === process.argv[1] && !leaked ? 0 : 9);",
            "});",
          ].join("\n"),
          "8c6bb4ecb5f9adadb0fec015d9e69e5f8a0c4c0bf597a7960f4be9c69b8c600a",
        ],
        command: process.execPath,
        team: "rat-stack",
      });

      expect(values).toEqual({
        TURBO_API: "https://cache.example.test",
        TURBO_TEAM: "rat-stack",
      });
      expect(JSON.stringify(stdout.mock.calls)).not.toContain(token);
      expect(JSON.stringify(stderr.mock.calls)).not.toContain(token);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "refuses undeployed records and never includes state contents in the error",
  () =>
    Effect.gen(function* missingToken() {
      const result = yield* handoffToken(
        () => Effect.succeed({ attr: { text: token } }),
        {
          args: ["-e", "process.exit(99)"],
          command: process.execPath,
          team: "rat-stack",
        }
      ).pipe(Effect.result);

      expect(Result.isFailure(result)).toBe(true);
      expect(JSON.stringify(result)).not.toContain(token);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "state reads refuse bootstrap and upgrade even when the caller enables provisioning",
  () =>
    Effect.gen(function* readOnlyStatePolicy() {
      const changed = yield* Ref.make(false);
      const mutate = Ref.set(changed, true);

      const missing = yield* withoutStateProvisioning(
        Provisioning.deployMissing(
          { backend: "cloudflare", label: "test store" },
          mutate
        )
      ).pipe(Effect.result);

      const outdated = yield* withoutStateProvisioning(
        Provisioning.upgradeOutdated(
          {
            backend: "cloudflare",
            expected: 2,
            label: "test store",
            observed: 1,
          },
          mutate
        )
      ).pipe(Effect.result);

      expect(Result.isFailure(missing)).toBe(true);
      expect(Result.isFailure(outdated)).toBe(true);
      expect(yield* Ref.get(changed)).toBe(false);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(AlchemyContext, {
            adopt: false,
            dev: false,
            dotAlchemy: ".alchemy",
            updateStateStore: true,
          }),
          ConfigProvider.layer(ConfigProvider.fromUnknown({ CI: false }))
        )
      )
    )
);
