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

const LogLevelSchema = Schema.Literals([
  "debug",
  "info",
  "log",
  "warn",
  "error",
]);

const CrashLogSchema = Schema.Struct({
  level: Schema.NullOr(LogLevelSchema),
  message: Schema.Array(Schema.String),
});

export const CrashRecordSchema = Schema.Struct({
  eventTime: EventTimeSchema,
  exceptions: Schema.Array(ExceptionSchema),
  logs: Schema.optional(Schema.Array(CrashLogSchema)),
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
  logs: Schema.optional(
    Schema.Array(
      Schema.Struct({
        level: Schema.optional(Schema.String),
        message: Schema.Array(Schema.Unknown),
      })
    )
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
    result = result.replaceAll(
      secret,
      (match, offset: number, input: string) =>
        /[\p{L}\p{N}_%-]/u.test(input.slice(offset - 1, offset)) ||
        /[\p{L}\p{N}_%-]/u.test(
          input.slice(offset + match.length, offset + match.length + 1)
        )
          ? match
          : "[redacted]"
    );
  }

  return result
    .replaceAll(/https?:\/\/[^\s/@]+:[^\s/@]+@/giu, "https://[redacted]@")
    .replaceAll(
      /(?<path>(?:https?:\/\/|\/)[^\s"'`()?]*)\?[^\s"'`)\]}]*/giu,
      "$<path>?[redacted]"
    )
    .replaceAll(/\?[^\s"'`)\]}]*=[^\s"'`)\]}]*/gu, "?[redacted]")
    .replaceAll(/\bBearer\s+[^\s"'`,;)]+/giu, "Bearer [redacted]")
    .replaceAll(
      /(?<label>\b(?:[a-z][\w-]*[_-])?(?:authorization|cookie|password|passwd|secret|token|key|api[_-]?key|access[_-]?key|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|credential)\b["']?\s*[:=]\s*["']?)[^\s"'`,;})]+/giu,
      "$<label>[redacted]"
    )
    .replaceAll(
      /-----BEGIN [\w ]*PRIVATE KEY-----[\s\S]*?-----END [\w ]*PRIVATE KEY-----/gu,
      "[redacted]"
    )
    .replaceAll(
      /\b(?:sk[_-](?:live|test|proj)[_-]|sk-|gh[pousr]_|github_pat_|xox[baprs]-|AKIA)[A-Za-z0-9_%.-]+/gu,
      "[redacted]"
    )
    .replaceAll(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu,
      "[redacted]"
    )
    .replaceAll(
      /\b(?:[a-f\d]{32,}|(?=[A-Za-z\d_+-]*[A-Z])(?=[A-Za-z\d_+-]*[a-z])(?=[A-Za-z\d_+-]*\d)[A-Za-z\d_+-]{32,})={0,2}\b/gu,
      "[redacted]"
    )
    .replaceAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, "[ip]")
    .replaceAll(
      /\b(?:[\da-fA-F]{1,4}:){7}[\da-fA-F]{1,4}\b|[\da-fA-F:]*::[\da-fA-F:]*/gu,
      "[ip]"
    )
    .replaceAll(/[\w.+%-]+(?:@|%40)[\w.%+-]+/giu, "[email]");
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

    const headerValues = Object.entries(request?.headers ?? {})
      .filter(([key]) =>
        /^(?:authorization|proxy-authorization|cookie|(?:x-)?(?:api-key|auth-token|access-token|secret))$/iu.test(
          key
        )
      )
      .map(([, value]) => value);

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
        message: redact(exception.message, secrets),
        name: diagnosticName(exception.name),
        stack: (exception.stack ?? "").split("\n").flatMap((line) => {
          const frame =
            /^\s*at\s+(?:.*\()?\s*(?<file>[\w.-]+\.(?:js|mjs|cjs|ts)):(?<line>\d+)(?::(?<column>\d+))?\)?\s*$/u.exec(
              line
            );

          return frame === null
            ? []
            : [
                redact(
                  [frame.groups?.file, frame.groups?.line, frame.groups?.column]
                    .filter(Schema.is(Schema.String))
                    .join(":"),
                  secrets
                ),
              ];
        }),
      })),
      logs:
        trace.outcome !== "exception" && trace.exceptions.length === 0
          ? []
          : (trace.logs ?? []).map((log) => ({
              level: Schema.is(LogLevelSchema)(log.level) ? log.level : null,
              message: log.message
                .filter(Schema.is(Schema.String))
                .map((message) =>
                  /(?:["']?(?:headers|body|request)["']?\s*[:=]\s*[[{])|^\s*(?:\{|\[\s*["'{[])/iu.test(
                    message
                  )
                    ? "[structured log omitted]"
                    : redact(message, secrets)
                ),
            })),
      outcome: Schema.is(OutcomeSchema)(trace.outcome)
        ? trace.outcome
        : "unknown",
      path: url === undefined ? null : redact(url.pathname, []),
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
