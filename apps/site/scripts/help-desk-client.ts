import { Config, Effect, Option, Redacted, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

export class HelpDeskCallFailed extends Schema.TaggedError<
  HelpDeskCallFailed,
  { readonly brand: unique symbol }
>()("HelpDeskCallFailed", {
  capability: Schema.String,
  detail: Schema.String,
  status: Schema.Finite,
}) {
  override get message() {
    return `${this.capability} returned ${String(this.status)}: ${this.detail}. The help desk refused or could not answer the operator call. Fix: check \`TOKENMAXX_HELP_OPERATOR_TOKEN\` and the origin, then rerun \`pnpm --filter @rat-stack/site help:reports <origin>\`.`;
  }
}

export const Origin = Schema.String.check(
  Schema.isPattern(/^https:\/\/[^\s/]+$/u, {
    message:
      "The origin must be an https origin with no path, such as https://ratstack.sh. Operator calls send the bearer token, so plain http is refused.",
  })
);

const Refusal = Schema.fromJsonString(
  Schema.Struct({
    _tag: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
  })
);

export const operatorCall = <S extends Schema.Decoder<unknown>>(
  origin: string,
  capability: "answerSetupProblem" | "listSetupProblems" | "setupHelpStatus",
  body: Schema.Json,
  output: S
) =>
  Effect.gen(function* callHelpDesk() {
    const token = yield* Config.Redacted("TOKENMAXX_HELP_OPERATOR_TOKEN");

    const response = yield* HttpClient.execute(
      HttpClientRequest.post(`${origin}/tokenmaxx/api/${capability}`).pipe(
        HttpClientRequest.setHeader(
          "authorization",
          `Bearer ${Redacted.value(token)}`
        ),
        HttpClientRequest.bodyText(JSON.stringify(body), "application/json")
      )
    );

    const text = yield* response.text;

    if (response.status !== 200) {
      const refusal = Schema.decodeOption(Refusal)(text);

      return yield* new HelpDeskCallFailed({
        capability,
        detail: Option.match(refusal, {
          onNone: () => "no readable error body",
          onSome: (parsed) =>
            `${parsed._tag ?? "error"}: ${parsed.message ?? "no message"}`,
        }),
        status: response.status,
      });
    }

    return yield* Schema.decodeEffect(Schema.fromJsonString(output))(text);
  });
