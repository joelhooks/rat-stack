import {
  Config,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";

export interface SetupHelpSettings {
  readonly attendees: Option.Option<readonly string[]>;
  readonly code: Option.Option<Redacted.Redacted>;
  readonly operatorToken: Option.Option<Redacted.Redacted>;
  readonly tests: readonly string[];
}

export const EmailHashList = Schema.fromJsonString(
  Schema.Array(
    Schema.String.check(Schema.isPattern(/^[0-9a-fA-F]{64}$/u)).annotate({
      description:
        "The sha256 hex digest of one trimmed, lowercased email address.",
    })
  )
);

const decodeHashes = Schema.decodeUnknownOption(EmailHashList);

const lowercase = (hash: string) => hash.toLowerCase();

const hashesIn = (secret: Redacted.Redacted) =>
  decodeHashes(Redacted.value(secret)).pipe(
    Option.map((hashes) => hashes.map(lowercase))
  );

const nonBlank = (secret: Option.Option<Redacted.Redacted>) =>
  secret.pipe(
    Option.filter((value) => Redacted.value(value).trim().length > 0)
  );

const read = (name: string) =>
  Config.option(Config.Redacted(name)).pipe(Effect.map(nonBlank));

export const signInReady = (settings: SetupHelpSettings) =>
  Option.isSome(settings.code) &&
  (Option.isSome(settings.attendees) || settings.tests.length > 0);

export const readSetupHelpSettings = Effect.gen(function* readHelpAccess() {
  const attendees = (yield* read("TOKENMAXX_ATTENDEE_HASHES")).pipe(
    Option.map(hashesIn)
  );

  const malformedAttendees =
    Option.isSome(attendees) && Option.isNone(attendees.value);

  const tests = (yield* read("TOKENMAXX_TEST_HASHES")).pipe(
    Option.flatMap(hashesIn),
    Option.getOrElse(() => [])
  );

  return {
    attendees: Option.flatten(attendees),
    code: yield* read("TOKENMAXX_WORKSHOP_CODE"),
    operatorToken: yield* read("TOKENMAXX_HELP_OPERATOR_TOKEN"),
    tests: malformedAttendees ? [] : tests,
  } satisfies SetupHelpSettings;
}).pipe(Effect.orElseSucceed(() => unconfiguredHelp));

export class SetupHelpAccess extends Context.Service<
  SetupHelpAccess,
  SetupHelpSettings
>()("rat-stack/SetupHelpAccess") {
  static readonly configLayer = (settings: SetupHelpSettings) =>
    Layer.succeed(SetupHelpAccess, settings);

  static readonly layer = Layer.effect(SetupHelpAccess, readSetupHelpSettings);
}

export const unconfiguredHelp: SetupHelpSettings = {
  attendees: Option.none(),
  code: Option.none(),
  operatorToken: Option.none(),
  tests: [],
};
