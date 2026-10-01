import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect } from "effect";

import {
  MISCHIEF_CONFIG_NAMES,
  fingerprintOf,
  mischiefConfigFingerprint,
} from "../src/config-fingerprint.js";

const fingerprintFor = (env: Record<string, string>) =>
  mischiefConfigFingerprint.parse(ConfigProvider.fromEnv({ env }));

it.effect("is a 64 character hex digest that carries no config value", () =>
  Effect.gen(function* digest() {
    const value = yield* fingerprintFor({
      DROVR_INTAKE_CREDENTIAL: "placeholder-credential",
      INTEREST_MODE: "drovr",
    });

    expect(value).toMatch(/^[0-9a-f]{64}$/u);
    expect(value).not.toContain("placeholder");
  })
);

it.effect("changes when any watched config value changes", () =>
  Effect.gen(function* changes() {
    const base = yield* fingerprintFor({});

    expect(yield* fingerprintFor({})).toBe(base);

    const seen = new Set<string>([base]);

    for (const name of MISCHIEF_CONFIG_NAMES) {
      seen.add(yield* fingerprintFor({ [name]: "changed" }));
    }

    expect(seen.size).toBe(MISCHIEF_CONFIG_NAMES.length + 1);
  })
);

it.effect("is stable per entry list", () =>
  Effect.gen(function* stable() {
    const one = yield* fingerprintOf([["A", "1"]]);

    expect(yield* fingerprintOf([["A", "1"]])).toBe(one);
    expect(yield* fingerprintOf([["A", "2"]])).not.toBe(one);
  })
);
