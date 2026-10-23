import {
  Context,
  DateTime,
  Effect,
  Function,
  Layer,
  Predicate,
  Option,
  Schema,
} from "effect";

import { flagControlDefaults } from "./flag-control.js";
import {
  FlagScope,
  GlobalFlagScope,
  FlagExit,
  FlagThreshold,
  FlagKill,
  flagRungSchema,
  validateFlagScope,
} from "./flag-ladder.js";
import type { FlagRung, FlagScopeMismatch } from "./flag-ladder.js";
import type { FlagStorageError } from "./flag-storage-error.js";
import { InvalidFlagValue } from "./invalid-flag-value.js";

export { FlagScopeMismatch, validateFlagScope } from "./flag-ladder.js";

export { FlagStorageError } from "./flag-storage-error.js";

export { InvalidFlagValue } from "./invalid-flag-value.js";

export { UnknownFlag } from "./unknown-flag.js";

export const FlagContextSchema = Schema.Struct({
  scope: Schema.optionalKey(FlagScope),
  subject: Schema.optionalKey(Schema.NonEmptyString),
});

export type FlagContext = typeof FlagContextSchema.Type;

export const FlagMetadataSchema = Schema.Struct({
  name: Schema.NonEmptyString,
  owner: Schema.NonEmptyString,
  purpose: Schema.NonEmptyString,
  removeBy: Schema.String.check(
    Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u),
    Schema.makeFilter<string>(
      (value) =>
        Option.exists(
          DateTime.make(`${value}T00:00:00Z`),
          (date) => DateTime.formatIsoDateUtc(date) === value
        ),
      { expected: "a real removal date in YYYY-MM-DD form" }
    )
  ),
});

export interface Flag<A> extends FlagMetadata {
  readonly default: A;
  readonly schema: Schema.Codec<A, unknown>;
  readonly rungs: readonly [FlagRung<A>, ...FlagRung<A>[]];
  readonly readScope: Schema.ConstraintDecoder<typeof FlagScope.Type>;
  readonly kill: typeof FlagKill.Type;
  readonly failurePolicy: "use-catalog-default" | "refuse";
}

export type FlagMetadata = typeof FlagMetadataSchema.Type;

export const defineFlag = <A>(
  name: string,
  schema: Schema.Codec<A, unknown>,
  options: {
    readonly default: NoInfer<A>;
    readonly owner: string;
    readonly removeBy: string;
    readonly purpose: string;
    readonly rungs: readonly [FlagRung<NoInfer<A>>, ...FlagRung<NoInfer<A>>[]];
    readonly readScope?: Schema.ConstraintDecoder<typeof FlagScope.Type>;
    readonly kill?: typeof FlagKill.Type;
    readonly failurePolicy?: "use-catalog-default" | "refuse";
  }
): Flag<A> => {
  const rungs = Schema.decodeUnknownSync(
    Schema.NonEmptyArray(flagRungSchema(Schema.toType(schema)))
  )(options.rungs);

  const same = Schema.toEquivalence(Schema.toType(schema));

  if (
    new Set(rungs.map((rung) => rung.name)).size !== rungs.length ||
    !same(rungs[0].value, options.default) ||
    rungs.some(
      (rung, index) =>
        Predicate.isTagged(rung.exit, "final") !== (index === rungs.length - 1)
    ) ||
    rungs.some((rung, index) =>
      rungs.slice(0, index).some((prior) => same(prior.value, rung.value))
    )
  ) {
    throw new Error(
      `Flag ${name} needs unique rung names and values, its default first, evidence exits, and one final rung.`
    );
  }

  return {
    ...Schema.decodeUnknownSync(FlagMetadataSchema)({ name, ...options }),
    default: Schema.decodeUnknownSync(Schema.toType(schema))(options.default),
    failurePolicy: options.failurePolicy ?? "use-catalog-default",
    kill: options.kill ?? FlagKill.cases.default.make({}),
    readScope: options.readScope ?? GlobalFlagScope,
    rungs,
    schema,
  };
};

export const decodeFlag = <A>(flag: Flag<A>) =>
  Function.flow(
    Schema.decodeUnknownEffect(Schema.toType(flag.schema)),
    Effect.mapError(
      () =>
        new InvalidFlagValue({
          name: flag.name,
          repair: `Set ${flag.name} to a value accepted by its declared schema.`,
        })
    )
  );

export class Flags extends Context.Service<
  Flags,
  {
    readonly get: <A>(
      flag: Flag<A>,
      context: FlagContext
    ) => Effect.Effect<
      A,
      InvalidFlagValue | FlagStorageError | FlagScopeMismatch
    >;
    readonly registry: readonly Flag<unknown>[];
  }
>()("@rat-stack/core/Flags") {
  static defaults = (registry: readonly Flag<unknown>[]) =>
    Layer.merge(
      Layer.succeed(Flags, {
        get: (flag, context) =>
          validateFlagScope(flag, context.scope).pipe(
            Effect.andThen(decodeFlag(flag)(flag.default))
          ),
        registry,
      }),
      flagControlDefaults
    );
}

export const eventsEnabled = defineFlag("EVENTS_ENABLED", Schema.Boolean, {
  default: false,
  owner: "analytics",
  purpose: "Select deployment-time analytics resources.",
  removeBy: "2027-01-01",
  rungs: [
    {
      authority: "agent",
      exit: FlagExit.cases.evidence.make({
        requirements: [
          {
            event: "capture-check",
            read: "analytics acceptance report",
            threshold: FlagThreshold.cases["at-least"].make({ count: 1 }),
          },
        ],
      }),
      name: "disabled",
      value: false,
    },
    {
      authority: "owner",
      exit: FlagExit.cases.final.make({}),
      name: "enabled",
      value: true,
    },
  ],
});

export const eventsIdentityMode = defineFlag(
  "EVENTS_IDENTITY_MODE",
  Schema.Literals(["daily", "persistent"]),
  {
    default: "daily",
    owner: "analytics",
    purpose: "Choose visitor identity persistence.",
    removeBy: "2027-01-01",
    rungs: [
      {
        authority: "agent",
        exit: FlagExit.cases.evidence.make({
          requirements: [
            {
              event: "identity-check",
              read: "visitor identity acceptance report",
              threshold: FlagThreshold.cases["at-least"].make({ count: 1 }),
            },
          ],
        }),
        name: "daily",
        value: "daily",
      },
      {
        authority: "owner",
        exit: FlagExit.cases.final.make({}),
        name: "persistent",
        value: "persistent",
      },
    ],
  }
);

export const eventFlags = [eventsEnabled, eventsIdentityMode];
