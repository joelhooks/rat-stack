import { Config, Effect, Option, Redacted, Schema } from "effect";

import { DeployStepError } from "./contracts.js";

export const requiredProdKeys = (schema: string): readonly string[] => {
  const keys: string[] = [];
  let required = false;

  for (const line of schema.split("\n")) {
    if (line.startsWith("#") && line.includes("@required=forEnv(production)")) {
      required = true;
    }

    const key = /^(?<key>[A-Z][A-Z0-9_]*)=/u.exec(line)?.groups?.key;

    if (key !== undefined) {
      if (required) {
        keys.push(key);
      }

      required = false;
    }
  }

  return keys;
};

export const validateDeployInputs = Effect.fn("validateDeployInputs")(
  function* validateDeployInputs(schema: string) {
    const keys = requiredProdKeys(schema);

    if (keys.length === 0) {
      return yield* new DeployStepError({
        keys: [],
        reason: "no-required-production-inputs-declared",
        step: "preflight",
      });
    }

    const missing: string[] = [];

    for (const key of keys) {
      const value = yield* Config.Redacted(key).pipe(Config.option);

      if (
        Option.isNone(value) ||
        Redacted.value(value.value).trim().length === 0
      ) {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      return yield* new DeployStepError({
        keys: missing,
        reason: "missing-required-production-inputs",
        step: "preflight",
      });
    }

    yield* Config.Boolean("EVENTS_ENABLED").pipe(
      Effect.mapError(
        () =>
          new DeployStepError({
            keys: ["EVENTS_ENABLED"],
            reason: "invalid-deploy-input",
            step: "preflight",
          })
      )
    );
    const identity = yield* Config.String("EVENTS_IDENTITY_MODE");

    if (identity !== "daily" && identity !== "persistent") {
      return yield* new DeployStepError({
        keys: ["EVENTS_IDENTITY_MODE"],
        reason: "invalid-deploy-input",
        step: "preflight",
      });
    }

    return keys;
  },
  Effect.mapError((failure) =>
    Schema.is(DeployStepError)(failure)
      ? failure
      : new DeployStepError({
          keys: [],
          reason: "required-production-inputs-invalid",
          step: "preflight",
        })
  )
);
