import { NodeCrypto } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Approval } from "@rat-stack/capability/approval";
import { getFlag, listFlags } from "@rat-stack/core/flag-capabilities";
import { FlagTarget } from "@rat-stack/core/flag-control";
import {
  flipFeatureFlag,
  recordFlagEvidence,
  readFlagLedger,
} from "@rat-stack/core/flag-write-capabilities";
import {
  FlagScopeMismatch,
  Flags,
  eventFlags,
  eventsEnabled,
  eventsIdentityMode,
  defineFlag,
} from "@rat-stack/core/flags";
import {
  Config,
  ConfigProvider,
  DateTime,
  Effect,
  Layer,
  Schema,
} from "effect";

import { configFlagsLayer } from "../src/config.js";
import { checkFlagExpiry } from "../src/expiry.js";
import { memoryFlagsLayer } from "../src/memory.js";
import { binaryLadder } from "./flag-fixture.js";

const scopedFlag = defineFlag("SCOPED_SWITCH", Schema.Boolean, {
  default: false,
  owner: "tests",
  purpose: "Exercise scope failures.",
  readScope: Schema.Struct({ cohort: Schema.NonEmptyString }),
  removeBy: "2099-01-01",
  rungs: binaryLadder(false, true),
});

it.effect.prop(
  "all flag operations preserve typed scope repairs, including their error message",
  { scope: Schema.String },
  ({ scope }) =>
    Effect.gen(function* checkScopeRepairs() {
      const failures = [
        getFlag
          .handler({ context: { scope }, name: scopedFlag.name })
          .pipe(Effect.flip),
        recordFlagEvidence
          .handler({
            event: "check",
            name: scopedFlag.name,
            observed: 1,
            read: "acceptance report",
            ref: "report",
            rung: "off",
            scope,
          })
          .pipe(Effect.flip),
        flipFeatureFlag
          .handler({
            authority: "agent",
            name: scopedFlag.name,
            reason: "stop",
            scope,
            target: FlagTarget.cases.off.make({}),
          })
          .pipe(Effect.flip),
        readFlagLedger
          .handler({ limit: 1, name: scopedFlag.name, scope })
          .pipe(Effect.flip),
      ];

      for (const failure of failures) {
        const error = yield* failure;
        expect(Schema.is(FlagScopeMismatch)(error)).toBe(true);

        if (Schema.is(FlagScopeMismatch)(error)) {
          const encoded = yield* Schema.encodeEffect(FlagScopeMismatch)(error);
          expect(encoded.repair).toContain("readScope");
          expect(error.message).toBe(encoded.repair);
        }
      }
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          memoryFlagsLayer([scopedFlag]),
          NodeCrypto.layer,
          Approval.denyAll
        )
      )
    )
);

it.effect.prop(
  "Config preserves the existing events boolean and identity semantics",
  {
    enabled: Schema.Literals([
      "true",
      "false",
      "yes",
      "no",
      "on",
      "off",
      "1",
      "0",
      "y",
      "n",
    ]),
    identity: Schema.Literals(["daily", "persistent"]),
  },
  ({ enabled, identity }) =>
    Effect.gen(function* compareConfig() {
      const previous = yield* Config.Boolean("EVENTS_ENABLED").pipe(
        Config.withDefault(false)
      );

      const previousIdentity = yield* Config.schema(
        eventsIdentityMode.schema,
        "EVENTS_IDENTITY_MODE"
      ).pipe(Config.withDefault("daily"));

      const flags = yield* Flags.pipe(
        Effect.provide(configFlagsLayer(eventFlags))
      );

      expect(yield* flags.get(eventsEnabled, {})).toBe(previous);
      expect(yield* flags.get(eventsIdentityMode, {})).toBe(previousIdentity);
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            EVENTS_ENABLED: enabled,
            EVENTS_IDENTITY_MODE: identity,
          })
        )
      )
    )
);

it.effect(
  "missing Config uses defaults and invalid Config fails initialization",
  () =>
    Effect.gen(function* configBoundaries() {
      const absent = configFlagsLayer(eventFlags).pipe(
        Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({})))
      );

      const flags = yield* Flags.pipe(Effect.provide(absent));
      expect(yield* flags.get(eventsEnabled, {})).toBe(false);
      expect(yield* flags.get(eventsIdentityMode, {})).toBe("daily");

      const invalid = configFlagsLayer(eventFlags).pipe(
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({ EVENTS_ENABLED: "broken" })
          )
        )
      );

      expect(
        (yield* Flags.pipe(Effect.provide(invalid), Effect.flip))._tag
      ).toBe("ConfigError");
    })
);

it.effect(
  "memory and projected handlers decode values and refuse unknown flags",
  () =>
    Effect.gen(function* flagSeams() {
      const registry = yield* listFlags.handler({});
      expect(registry.map((entry) => entry.name)).toStrictEqual(
        eventFlags.map((entry) => entry.name)
      );
      expect(
        yield* getFlag.handler({
          context: { subject: "allowed" },
          name: "EVENTS_ENABLED",
        })
      ).toBe(true);
      expect(
        yield* getFlag.handler({
          context: { subject: "other" },
          name: "EVENTS_ENABLED",
        })
      ).toBe(false);
      expect(
        (yield* getFlag
          .handler({ context: {}, name: "missing" })
          .pipe(Effect.flip))._tag
      ).toBe("UnknownFlag");
    }).pipe(
      Effect.provide(
        memoryFlagsLayer(
          eventFlags,
          new Map([
            [eventsEnabled.name, [{ subjects: ["allowed"], value: true }]],
          ])
        )
      )
    )
);

it.effect("expired declarations fail with owner context and a repair", () =>
  Effect.gen(function* expiryBoundary() {
    yield* DateTime.now;

    const expired = defineFlag("old", Schema.Boolean, {
      default: false,
      owner: "tests",
      purpose: "Exercise expiry.",
      removeBy: "1969-01-01",
      rungs: binaryLadder(false, true),
    });

    const current = defineFlag("current", Schema.Boolean, {
      default: false,
      owner: "tests",
      purpose: "Exercise expiry.",
      removeBy: "2099-01-01",
      rungs: binaryLadder(false, true),
    });

    const error = yield* checkFlagExpiry([expired, current]).pipe(Effect.flip);
    expect(error.flags).toStrictEqual([
      { name: "old", owner: "tests", removeBy: "1969-01-01" },
    ]);
    expect(error.repair).toContain("Remove each expired flag");
    yield* checkFlagExpiry([current]);
  })
);
