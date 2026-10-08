import type { ProgressReporter } from "alchemy/Report";
import { Progress } from "alchemy/Report";
import { Cause, Effect, Exit, Option, Predicate, Ref, Schema } from "effect";
import type { Tracer } from "effect";
import * as HttpClient from "effect/http/HttpClient";

import type { ProviderError } from "./contracts.js";

const ApiError = Schema.Struct({
  code: Schema.optional(Schema.Int),
  message: Schema.String,
});

const ErrorEnvelope = Schema.Struct({
  errors: Schema.Array(ApiError),
});

interface FailedResource {
  readonly resource: string;
  readonly message: string;
}

interface FailedResponse {
  readonly resource: string | null;
  readonly errors: readonly (typeof ApiError.Type)[];
}

const redactProviderMessage = (message: string, secrets: readonly string[]) => {
  if (/(?:^|[\s:])(?:\{\s*"|\[\s*(?:\{|\[|"))/u.test(message)) {
    return "[structured provider message omitted]";
  }

  let redacted = message;

  for (const secret of secrets
    .filter((value) => value !== "")
    .toSorted((a, b) => b.length - a.length)) {
    redacted = redacted.replaceAll(secret, "[redacted]");
  }

  return redacted
    .replaceAll(/\bBearer\s+[^\s"'`,;)]+/giu, "Bearer [redacted]")
    .replaceAll(
      /(?<label>\b(?:[a-z][\w-]*[_-])?(?:authorization|cookie|password|secret|token|key|api[_-]?key|credential)\b["']?\s*[:=]\s*["']?)[^\s"'`,;})]+/giu,
      "$<label>[redacted]"
    )
    .replaceAll(
      /\b(?:sk-|sk_(?:live|test)_|gh[pousr]_|github_pat_|AKIA)[\w.-]+/gu,
      "[redacted]"
    )
    .replaceAll(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/gu, "[redacted]")
    .replaceAll(
      /-----BEGIN [\w ]*PRIVATE KEY-----[\s\S]*?-----END [\w ]*PRIVATE KEY-----/gu,
      "[redacted]"
    )
    .replaceAll(/https?:\/\/[^\s"')]+/giu, "[url]")
    .replaceAll(/\?[^\s"'`)\]}]*=[^\s"'`)\]}]*/gu, "?[redacted]")
    .replaceAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, "[ip]")
    .replaceAll(
      /(?<![\w:])(?=[a-f\d:]*[a-f\d])(?:[a-f\d]{0,4}:){2,}[a-f\d]{0,4}(?![\w:])/giu,
      "[ip]"
    )
    .replaceAll(/\b[A-Za-z\d_-]{40,}\b/gu, "[redacted]")
    .replaceAll(/[\w.+%-]+(?:@|%40)[\w.%+-]+/giu, "[email]")
    .replaceAll(/\b[a-f\d]{32,}\b/giu, "[redacted]")
    .replaceAll(/\/(?:Users|home)\/[^\s"')]+/gu, "[path]");
};

const currentResource = Effect.gen(function* providerResource() {
  let span: Tracer.AnySpan | undefined = Option.getOrUndefined(
    yield* Effect.option(Effect.currentSpan)
  );

  while (span !== undefined && Predicate.isTagged(span, "Span")) {
    const resource = Schema.decodeUnknownOption(Schema.String)(
      span.attributes.get("alchemy.resource.fqn")
    );

    if (Option.isSome(resource)) {
      return resource.value;
    }

    span = Option.getOrUndefined(span.parent);
  }

  return null;
});

const matchesFailure = (failure: FailedResource, response: FailedResponse) => {
  const message = response.errors[0]?.message.split("\n")[0];

  return (
    message !== undefined &&
    message !== "" &&
    (response.resource === null || response.resource === failure.resource) &&
    (failure.message === message || failure.message.endsWith(`: ${message}`))
  );
};

export const applyWithProviderEvidence = Effect.fnUntraced(
  function* applyWithProviderEvidence<A, E, R>(
    apply: (client: HttpClient.HttpClient) => Effect.Effect<A, E, R>,
    client: HttpClient.HttpClient,
    report: ProgressReporter,
    secrets: readonly string[] = []
  ) {
    const failures = yield* Ref.make<readonly FailedResource[]>([]);
    const responses = yield* Ref.make<readonly FailedResponse[]>([]);

    const observed = HttpClient.transformResponse(client, (work) =>
      work.pipe(
        Effect.tap((response) =>
          Effect.gen(function* observeUploadFailure() {
            const { request } = response;

            const url = URL.canParse(request.url)
              ? new URL(request.url)
              : undefined;

            if (
              url?.hostname !== "api.cloudflare.com" ||
              !/\/workers\/scripts\/[^/]+(?:\/versions)?$/u.test(
                url.pathname
              ) ||
              (request.method !== "PUT" && request.method !== "POST")
            ) {
              return;
            }

            const envelope = yield* response.json.pipe(
              Effect.map(Schema.decodeUnknownOption(ErrorEnvelope)),
              Effect.catch(() => Effect.succeedNone)
            );

            if (Option.isSome(envelope) && envelope.value.errors.length > 0) {
              const resource = yield* currentResource;
              yield* Ref.update(responses, (rows) => [
                ...rows,
                { errors: envelope.value.errors, resource },
              ]);
            }
          })
        )
      )
    );

    const exit = yield* apply(observed).pipe(
      Effect.provideService(Progress, (event) =>
        (Predicate.isTagged(event, "apply.resource.status") &&
        event.status === "fail"
          ? Ref.update(failures, (rows) => [
              ...rows,
              { message: event.message ?? "", resource: event.fqn },
            ])
          : Effect.void
        ).pipe(Effect.andThen(report(event)))
      ),
      Effect.exit
    );

    if (Exit.isSuccess(exit) || Cause.hasInterrupts(exit.cause)) {
      return { exit, providerErrors: [] };
    }

    const failed = yield* Ref.get(failures);
    const captured = yield* Ref.get(responses);

    const causeErrors = exit.cause.reasons.flatMap((reason) => {
      if (!Cause.isFailReason(reason) && !Cause.isDieReason(reason)) {
        return [];
      }

      const value = Cause.isFailReason(reason) ? reason.error : reason.defect;
      const error = Schema.decodeUnknownOption(ApiError)(value);

      return Option.isSome(error) ? [error.value] : [];
    });

    const providerErrors: readonly ProviderError[] =
      failed.length === 0
        ? causeErrors.flatMap((causeError) => {
            const candidates = captured.filter((response) =>
              matchesFailure(
                {
                  message: causeError.message.split("\n")[0] ?? "",
                  resource: response.resource ?? "",
                },
                response
              )
            );

            if (candidates.length === 1) {
              const [response] = candidates;

              if (response !== undefined) {
                return response.errors.map((apiError) => ({
                  code: apiError.code ?? null,
                  message: redactProviderMessage(apiError.message, secrets),
                  resource:
                    response.resource === null
                      ? null
                      : redactProviderMessage(response.resource, secrets),
                }));
              }
            }

            return [
              {
                code: causeError.code ?? null,
                message: redactProviderMessage(causeError.message, secrets),
                resource: null,
              },
            ];
          })
        : failed.flatMap((failure) => {
            const candidates = captured.filter((response) =>
              matchesFailure(failure, response)
            );

            const bound = candidates.findLast(
              (response) => response.resource === failure.resource
            );

            const response =
              bound ?? (candidates.length === 1 ? candidates[0] : undefined);

            if (response !== undefined) {
              return response.errors.map((error) => ({
                code: error.code ?? null,
                message: redactProviderMessage(error.message, secrets),
                resource: redactProviderMessage(failure.resource, secrets),
              }));
            }

            const causes = causeErrors.filter((error) =>
              matchesFailure(failure, { errors: [error], resource: null })
            );

            return [
              {
                code: causes.length === 1 ? (causes[0]?.code ?? null) : null,
                message: redactProviderMessage(
                  failure.message ||
                    "Provider failed without a diagnostic message",
                  secrets
                ),
                resource: redactProviderMessage(failure.resource, secrets),
              },
            ];
          });

    return { exit, providerErrors };
  }
);
