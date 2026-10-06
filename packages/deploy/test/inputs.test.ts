import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Schema } from "effect";

import { validateDeployInputs } from "../src/inputs.js";

const keys = [
  "ALCHEMY_PROFILE",
  "EMAIL_FORWARD_TO",
  "EVENTS_ENABLED",
  "EVENTS_IDENTITY_MODE",
  "EVENTS_SINK_TOKEN",
];

const schema = keys
  .map((key) => `# @required=forEnv(production)\n${key}=\n`)
  .join("\n");

const values = {
  ALCHEMY_PROFILE: "test-profile",
  EMAIL_FORWARD_TO: "test-destination",
  EVENTS_ENABLED: "true",
  EVENTS_IDENTITY_MODE: "persistent",
  EVENTS_SINK_TOKEN: "test-secret",
};

it.effect.prop(
  "missing production inputs name only their keys before planning",
  { missing: Schema.Literals(keys) },
  ({ missing }) =>
    Effect.gen(function* test() {
      const env = Object.fromEntries(
        Object.entries(values).filter(([key]) => key !== missing)
      );

      const failure = yield* validateDeployInputs(schema).pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({ env })
        ),
        Effect.flip
      );

      expect(failure.keys).toStrictEqual([missing]);
      expect(JSON.stringify(failure)).not.toContain("test-secret");
    }),
  { arbitrary: { runs: 100 } }
);

it.effect("explicit analytics settings preserve the required key set", () =>
  Effect.gen(function* test() {
    const found = yield* validateDeployInputs(schema).pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({ env: values })
      )
    );

    expect(found).toStrictEqual(keys);
  })
);
