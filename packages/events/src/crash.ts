import { Context, Effect, Schema } from "effect";

import type { CrashArchiveError } from "./crash-archive-error.js";
import { InvalidCrashTrace } from "./invalid-crash-trace.js";

export { CrashArchiveError } from "./crash-archive-error.js";

export { InvalidCrashTrace } from "./invalid-crash-trace.js";

const EventTimeSchema = Schema.NullOr(
  Schema.Int.check(
    Schema.isBetween({ maximum: 8_640_000_000_000_000, minimum: 0 })
  )
);

const OutcomeSchema = Schema.Literals([
  "ok",
  "exception",
  "exceededCpu",
  "exceededMemory",
  "exceededDuration",
  "responseStreamDisconnected",
  "canceled",
  "unknown",
]);

const ExceptionSchema = Schema.Struct({
  message: Schema.String,
  name: Schema.String,
  stack: Schema.Array(Schema.String),
});

export const CrashRecordSchema = Schema.Struct({
  eventTime: EventTimeSchema,
  exceptions: Schema.Array(ExceptionSchema),
  outcome: OutcomeSchema,
  path: Schema.NullOr(Schema.String),
  scriptVersion: Schema.NullOr(Schema.String),
});

export type CrashRecord = typeof CrashRecordSchema.Type;

export const TraceSchema = Schema.Struct({
  event: Schema.NullOr(
    Schema.Struct({
      request: Schema.optional(
        Schema.Struct({
          headers: Schema.Record(Schema.String, Schema.String),
          url: Schema.String,
        })
      ),
    })
  ),
  eventTimestamp: EventTimeSchema,
  exceptions: Schema.Array(
    Schema.Struct({
      message: Schema.String,
      name: Schema.String,
      stack: Schema.optional(Schema.String),
    })
  ),
  outcome: Schema.String,
  scriptVersion: Schema.optional(
    Schema.Struct({ id: Schema.String.check(Schema.isUUID()) })
  ),
});

export class CrashArchive extends Context.Service<
  CrashArchive,
  {
    readonly record: (
      record: CrashRecord
    ) => Effect.Effect<void, CrashArchiveError | InvalidCrashTrace>;
  }
>()("@rat-stack/events/CrashArchive") {}

const parseUrl = (url: string) => {
  const parsed = URL.canParse(url) ? new URL(url) : undefined;

  return parsed?.protocol === "https:" || parsed?.protocol === "http:"
    ? parsed
    : undefined;
};

const redact = (text: string, secrets: readonly string[]) => {
  let result = text;

  for (const secret of secrets) {
    if (secret !== "") {
      result = result.replaceAll(secret, "[redacted]");
    }
  }

  return result
    .replaceAll(/https?:\/\/[^\s)]+/gu, "[url]")
    .replaceAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, "[ip]")
    .replaceAll(
      /\b(?:[\da-fA-F]{1,4}:){7}[\da-fA-F]{1,4}\b|[\da-fA-F:]*::[\da-fA-F:]*/gu,
      "[ip]"
    )
    .replaceAll(/[\w.+-]+@[\w.-]+/gu, "[email]")
    .replaceAll(/(?<quote>["'`]).*?\k<quote>/gu, "[quoted]");
};

const diagnosticMessage = (text: string, secrets: readonly string[]) => {
  const sanitized = redact(text, secrets);

  if (
    /^Cannot read propert(?:y|ies) (?:\[quoted\] |of )?(?:undefined|null)(?: \(reading \[quoted\]\))?$/u.test(
      sanitized
    )
  ) {
    return sanitized;
  }

  const diagnostics = [
    "is not a function",
    "is not defined",
    "Maximum call stack size exceeded",
    "The script will never generate a response",
    "Cannot perform I/O on behalf of a different request",
    "Disallowed operation called within global scope",
    "Script startup exceeded CPU time limit",
    "Network connection lost",
    "Invalid URL",
    "Unexpected token",
    "Unexpected end of JSON input",
  ];

  return (
    diagnostics.find((message) => sanitized.includes(message)) ??
    "[redacted message]"
  );
};

const diagnosticName = (name: string) =>
  [
    "Error",
    "TypeError",
    "ReferenceError",
    "SyntaxError",
    "RangeError",
    "URIError",
    "EvalError",
    "AggregateError",
  ].includes(name)
    ? name
    : "[redacted name]";

export const projectCrash = Effect.fn("projectCrash")(
  function* projectCrashTrace(input: typeof TraceSchema.Type) {
    const trace = yield* Schema.decodeEffect(TraceSchema)(input).pipe(
      Effect.mapError(() => new InvalidCrashTrace())
    );

    if (trace.outcome === "ok" && trace.exceptions.length === 0) {
      return null;
    }

    const request = trace.event?.request;
    const url = request === undefined ? undefined : parseUrl(request.url);
    const headerValues = Object.values(request?.headers ?? {});

    const cookieValues = Object.entries(request?.headers ?? {})
      .filter(([key]) => key.toLowerCase() === "cookie")
      .flatMap(([, value]) => value.split(";"))
      .map((pair) => pair.slice(pair.indexOf("=") + 1).trim());

    const headerTokens = headerValues.flatMap((value) => value.split(/\s+/u));
    const queryValues = [...(url?.searchParams.values() ?? [])];

    const secrets = [
      ...headerValues,
      ...headerTokens,
      ...cookieValues,
      ...queryValues,
    ]
      .flatMap((value) => [
        value,
        encodeURIComponent(value.replaceAll(/[\uD800-\uDFFF]/gu, "\uFFFD")),
      ])
      .filter((value) => value !== "")
      .toSorted((a, b) => b.length - a.length);

    const record: CrashRecord = {
      eventTime: trace.eventTimestamp,
      exceptions: trace.exceptions.map((exception) => ({
        message: diagnosticMessage(exception.message, secrets),
        name: diagnosticName(exception.name),
        stack: (exception.stack ?? "").split("\n").flatMap((line) => {
          const frame =
            /^\s*at\s+.*?(?<file>[\w.-]+\.(?:js|mjs|cjs|ts)):(?<line>\d+):(?<column>\d+)\)?\s*$/u.exec(
              line
            );

          return frame === null
            ? []
            : [
                redact(
                  `${frame.groups?.file}:${frame.groups?.line}:${frame.groups?.column}`,
                  secrets
                ),
              ];
        }),
      })),
      outcome: Schema.is(OutcomeSchema)(trace.outcome)
        ? trace.outcome
        : "unknown",
      path: url === undefined ? null : redact(url.pathname, secrets),
      scriptVersion: trace.scriptVersion?.id ?? null,
    };

    return yield* Schema.decodeEffect(CrashRecordSchema)(record).pipe(
      Effect.mapError(() => new InvalidCrashTrace())
    );
  }
);

export const captureCrashes = Effect.fn("captureCrashes")(
  function* captureCrashTraces(traces: readonly (typeof TraceSchema.Type)[]) {
    const archive = yield* CrashArchive;

    for (const trace of traces) {
      const record = yield* projectCrash(trace);

      if (record !== null) {
        yield* archive.record(record);
      }
    }
  }
);
