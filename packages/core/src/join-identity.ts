import { Effect, Schema, SchemaIssue, SchemaTransformation } from "effect";

export const ApplicantName = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(100)
).annotate({
  description:
    "How you want Joel to call you. Up to 100 characters after trimming.",
});

const profileForm =
  /^(?:@?(?<bare>[a-z0-9_]{1,15})|(?<prefix>(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/)(?<profile>[a-z0-9_]{1,15})\/?(?:\?[^\s#]*)?(?:#[^\s]*)?)$/iu;

const asciiHandle = Schema.is(
  Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_]{1,15}$/u))
);

const asciiPrefix = Schema.is(
  Schema.String.check(Schema.isPattern(/^[a-zA-Z.:/]*$/u))
);

const reservedPaths = new Set([
  "i",
  "intent",
  "home",
  "explore",
  "search",
  "settings",
  "messages",
  "notifications",
  "compose",
  "login",
  "logout",
  "signup",
  "tos",
  "privacy",
]);

export const ApplicantX = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String.check(
      Schema.isPattern(/^https:\/\/x\.com\/[a-z0-9_]{1,15}$/u)
    ),
    SchemaTransformation.transformEffect({
      decode: (input, options) => {
        const match = profileForm.exec(input.trim());
        const rawHandle = match?.groups?.bare ?? match?.groups?.profile;
        const handle = rawHandle?.toLowerCase();

        return !asciiPrefix(match?.groups?.prefix ?? "") ||
          !asciiHandle(rawHandle) ||
          handle === undefined ||
          reservedPaths.has(handle)
          ? Effect.fail(
              new SchemaIssue.InvalidValue(
                {
                  message:
                    "Expected an X profile: @handle, handle, or an x.com/twitter.com profile URL. Use 1–15 letters, digits or underscores; not a status, intent or navigation URL.",
                },
                undefined,
                options
              )
            )
          : Effect.succeed(`https://x.com/${handle}`);
      },
      encode: Effect.succeed,
    })
  )
).annotate({
  description:
    "Optional X/Twitter profile. Accepts @handle, handle, or a profile URL; normalizes to https://x.com/handle.",
});

export const JoinIdentity = Schema.Struct({
  name: Schema.optionalKey(ApplicantName),
  x: Schema.optionalKey(ApplicantX),
});
