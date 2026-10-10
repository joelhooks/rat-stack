import {
  Context,
  DateTime,
  Effect,
  Function,
  Layer,
  Option,
  Schema,
} from "effect";

import { InvalidFlagValue } from "./invalid-flag-value.js";

export { InvalidFlagValue } from "./invalid-flag-value.js";

export { UnknownFlag } from "./unknown-flag.js";

export const FlagContextSchema = Schema.Struct({
  subject: Schema.optionalKey(Schema.NonEmptyString),
});

export type FlagContext = typeof FlagContextSchema.Type;

export const FlagMetadataSchema = Schema.Struct({
  name: Schema.NonEmptyString,
  owner: Schema.NonEmptyString,
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
}

export type FlagMetadata = typeof FlagMetadataSchema.Type;

export const defineFlag = <A>(
  name: string,
  schema: Schema.Codec<A, unknown>,
  options: {
    readonly default: NoInfer<A>;
    readonly owner: string;
    readonly removeBy: string;
  }
): Flag<A> => ({
  ...Schema.decodeUnknownSync(FlagMetadataSchema)({ name, ...options }),
  default: Schema.decodeUnknownSync(Schema.toType(schema))(options.default),
  schema,
});

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
    ) => Effect.Effect<A, InvalidFlagValue>;
    readonly registry: readonly Flag<unknown>[];
  }
>()("@rat-stack/core/Flags") {
  static defaults = (registry: readonly Flag<unknown>[]) =>
    Layer.succeed(Flags, {
      get: (flag) => decodeFlag(flag)(flag.default),
      registry,
    });
}

export const eventsEnabled = defineFlag("EVENTS_ENABLED", Schema.Boolean, {
  default: false,
  owner: "analytics",
  removeBy: "2027-01-01",
});

export const eventsIdentityMode = defineFlag(
  "EVENTS_IDENTITY_MODE",
  Schema.Literals(["daily", "persistent"]),
  { default: "daily", owner: "analytics", removeBy: "2027-01-01" }
);

export const eventFlags = [eventsEnabled, eventsIdentityMode];
