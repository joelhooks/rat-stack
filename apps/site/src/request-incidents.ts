import {
  Cause,
  Effect,
  Match,
  Option,
  Predicate,
  Schema,
  Stream,
} from "effect";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerError from "effect/http/HttpServerError";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

const ErrorIdentity = Schema.Struct({
  _tag: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
});

const NativeErrorDetails = Schema.Struct({
  cause: Schema.optional(Schema.Unknown),
  message: Schema.String,
  name: Schema.String,
});

interface ErrorDiagnostic {
  readonly cause?: ErrorDiagnostic;
  readonly message: string;
  readonly name: string;
}

const redactMessage = (message: string) =>
  message
    .replaceAll(
      /[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/gu,
      "[redacted email]"
    )
    .replaceAll(
      /\b[a-z][a-z\d+.-]*:\/\/[^\s<>"']+/giu,
      (url) => url.split(/[?#]/u)[0] ?? "[redacted URL]"
    )
    .replaceAll(/\bBearer\s+[^\s,;]+/giu, "Bearer [redacted]")
    .replaceAll(
      /\b(?<key>[\w.-]*(?:token|secret|key|password|credential|salt|cookie|authorization|body)[\w.-]*)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/giu,
      "$<key>=[redacted]"
    )
    .replaceAll(/[A-Za-z\d+/_-]{24,}={0,2}/gu, "[redacted token]")
    .replaceAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, "[redacted address]")
    .replaceAll(
      /(?<![\w:])(?:[a-f\d]{0,4}:){2,}[a-f\d]{0,4}(?![\w:])/giu,
      "[redacted address]"
    )
    .replaceAll(/[?#][^\s<>"']+/gu, "[redacted query]")
    .slice(0, 300);

const errorClass = (cause: unknown) => {
  const identity = Schema.decodeUnknownOption(ErrorIdentity)(cause);

  const name = Option.isSome(identity)
    ? (identity.value._tag ?? identity.value.name ?? "UnknownError")
    : "UnknownError";

  return /^[A-Za-z][A-Za-z0-9_]{0,79}$/u.test(name) ? name : "UnknownError";
};

const errorDiagnostic = (
  cause: unknown,
  depth = 0
): ErrorDiagnostic | undefined => {
  if (Predicate.isString(cause)) {
    return { message: redactMessage(cause), name: "String" };
  }

  const identity = Schema.decodeUnknownOption(ErrorIdentity)(cause);

  if (Option.isSome(identity) && identity.value._tag !== undefined) {
    return undefined;
  }

  const details = Schema.decodeUnknownOption(NativeErrorDetails)(cause);

  if (Option.isNone(details)) {
    return undefined;
  }

  const nested =
    depth < 3 ? errorDiagnostic(details.value.cause, depth + 1) : undefined;

  const diagnostic = {
    message: redactMessage(details.value.message),
    name: errorClass(cause),
  };

  return nested === undefined ? diagnostic : { ...diagnostic, cause: nested };
};

class ReturnedServerError extends Schema.TaggedError<ReturnedServerError>()(
  "ReturnedServerError",
  {}
) {}

const privateError = (cause: unknown, includeMessage = true) => {
  const diagnostic = includeMessage ? errorDiagnostic(cause) : undefined;

  const error = new Error(diagnostic?.message ?? "Error details withheld");

  error.name = errorClass(cause);

  const positions = Predicate.isError(cause)
    ? (cause.stack ?? "")
        .split("\n")
        .slice(1, 9)
        .flatMap((frame) => {
          const position = /:(?<line>\d+):(?<column>\d+)\)?$/u.exec(frame);

          return position?.groups === undefined
            ? []
            : [
                `    at <source>:${position.groups.line}:${position.groups.column}`,
              ];
        })
    : [];

  error.stack = [`${error.name}: ${error.message}`, ...positions].join("\n");

  return error;
};

const acceptClass = (accept: string | undefined) => {
  if (accept === undefined || accept.trim() === "") {
    return "missing";
  }

  const types = new Set(
    accept
      .toLowerCase()
      .split(",")
      .map((entry) => entry.trim().split(";")[0])
  );

  if (types.has("text/html")) {
    return "html";
  }

  if (types.has("text/markdown")) {
    return "markdown";
  }

  if (types.has("application/json") || types.has("application/problem+json")) {
    return "json";
  }

  return types.has("*/*") ? "wildcard" : "other";
};

const newIncidentId = function newIncidentId(): string {
  // @effect-diagnostics-next-line cryptoRandomUUID:off -- Workers provide Web Crypto but no Effect Crypto layer; incident ids belong to the native HTTP boundary.
  return crypto.randomUUID();
};

export const logRequestIncident = Effect.fnUntraced(
  function* logRequestIncident(
    cause: Cause.Cause<unknown>,
    boundary: "content" | "fetch" | "response-body" | "initialization",
    incidentId: string = newIncidentId()
  ): Effect.fn.Return<string> {
    const request = yield* Effect.serviceOption(
      HttpServerRequest.HttpServerRequest
    );

    const route = yield* Effect.serviceOption(HttpRouter.RouteContext);

    const sanitized = Cause.fromReasons(
      cause.reasons.flatMap((reason) =>
        Match.value(reason).pipe(
          Match.tag(
            "Fail",
            (failure) =>
              Cause.fail(
                privateError(failure.error, Predicate.isError(failure.error))
              ).reasons
          ),
          Match.tag(
            "Die",
            (defect) => Cause.die(privateError(defect.defect)).reasons
          ),
          Match.tag("Interrupt", (interrupt) => [interrupt]),
          Match.exhaustive
        )
      )
    );

    const reason = cause.reasons.find(
      (entry) => !Cause.isInterruptReason(entry)
    );

    const diagnostic =
      reason === undefined
        ? undefined
        : Match.value(reason).pipe(
            Match.tag("Fail", (failure) =>
              Predicate.isError(failure.error)
                ? errorDiagnostic(failure.error)
                : undefined
            ),
            Match.tag("Die", (defect) => errorDiagnostic(defect.defect)),
            Match.exhaustive
          );

    const fallbackRoute =
      boundary === "initialization" ? "<initialization>" : "<unmatched>";

    yield* Effect.logError("HTTP request incident", {
      accept: acceptClass(
        Option.isSome(request) ? request.value.headers.accept : undefined
      ),
      boundary,
      cause: Cause.pretty(sanitized).slice(0, 2048),
      error: diagnostic,
      incidentId,
      kind: reason?._tag ?? "Unknown",
      method: Option.isSome(request) ? request.value.method : "INIT",
      route: Option.isSome(route) ? route.value.route.path : fallbackRoute,
      tag:
        reason === undefined
          ? "UnknownError"
          : errorClass(
              Cause.isFailReason(reason) ? reason.error : reason.defect
            ),
    });

    return incidentId;
  }
);

export const observeRequestIncidents = <E, R>(
  app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
) =>
  Effect.gen(function* observeRequest() {
    let response = yield* app.pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause)
          ? Effect.failCause(cause)
          : HttpServerError.causeResponse(cause).pipe(
              Effect.flatMap(([converted]) =>
                converted.status === 500
                  ? logRequestIncident(cause, "fetch").pipe(
                      Effect.map((id) =>
                        HttpServerResponse.setHeader(
                          converted,
                          "X-Incident-Id",
                          id
                        )
                      )
                    )
                  : Effect.succeed(converted)
              )
            )
      )
    );

    if (
      response.status === 500 &&
      response.headers["x-incident-id"] === undefined
    ) {
      const id = yield* logRequestIncident(
        Cause.fail(new ReturnedServerError()),
        "fetch"
      );

      response = HttpServerResponse.setHeader(response, "X-Incident-Id", id);
    }

    if (!Predicate.isTagged(response.body, "Stream")) {
      return response;
    }

    const context =
      yield* Effect.context<HttpServerRequest.HttpServerRequest>();

    const incidentId = response.headers["x-incident-id"] ?? newIncidentId();

    const body = HttpBody.stream(
      response.body.stream.pipe(
        Stream.catchCause((cause) =>
          Cause.hasInterrupts(cause)
            ? Stream.failCause(cause)
            : Stream.fromEffect(
                logRequestIncident(cause, "response-body", incidentId)
              ).pipe(Stream.flatMap(() => Stream.failCause(cause)))
        ),
        Stream.provideContext(context)
      ),
      response.body.contentType,
      response.body.contentLength
    );

    return HttpServerResponse.setBody(response, body).pipe(
      HttpServerResponse.setHeaders(response.headers),
      HttpServerResponse.setHeader("X-Incident-Id", incidentId)
    );
  });
