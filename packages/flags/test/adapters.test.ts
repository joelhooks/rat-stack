import { expect, it } from "@effect/vitest";
import { getFlag, listFlags } from "@rat-stack/core/flag-capabilities";
import {
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
      removeBy: "1969-01-01",
    });

    const current = defineFlag("current", Schema.Boolean, {
      default: false,
      owner: "tests",
      removeBy: "2099-01-01",
    });

    const error = yield* checkFlagExpiry([expired, current]).pipe(Effect.flip);
    expect(error.flags).toStrictEqual([
      { name: "old", owner: "tests", removeBy: "1969-01-01" },
    ]);
    expect(error.repair).toContain("Remove each expired flag");
    yield* checkFlagExpiry([current]);
  })
);
