import { SubscriberConfirm } from "@rat-stack/core/interest";
import type { ConfirmState } from "@rat-stack/core/interest";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

export const TOKEN_STATE_PATH = "/intake/token-state";

export const CONFIRM_PATH = "/intake/confirm";

export interface ConfirmSettings {
  readonly base: Option.Option<string>;
  readonly credential: Option.Option<Redacted.Redacted>;
}

const CONFIRM_TIMEOUT = "5 seconds";

const StateBody = Schema.Struct({
  state: Schema.Literals(["pending", "confirmed", "expired", "invalid"]),
});

const decodeState = Schema.decodeUnknownEffect(StateBody);

export const drovrConfirmLayer = (settings: ConfirmSettings) =>
  Layer.effect(
    SubscriberConfirm,
    Effect.gen(function* makeSubscriberConfirm() {
      const http = yield* HttpClient.HttpClient;

      const call = Effect.fn("SubscriberConfirm.call")(function* call(
        path: string,
        token: string
      ) {
        if (
          Option.isNone(settings.base) ||
          Option.isNone(settings.credential)
        ) {
          return "invalid" as const;
        }

        const request = HttpClientRequest.post(
          `${settings.base.value.replace(/\/+$/u, "")}${path}`
        ).pipe(
          HttpClientRequest.bearerToken(
            Redacted.value(settings.credential.value)
          ),
          HttpClientRequest.bodyJsonUnsafe({ token })
        );

        return yield* http.execute(request).pipe(
          Effect.timeout(CONFIRM_TIMEOUT),
          Effect.flatMap((response) =>
            response.status === 200
              ? response.json.pipe(
                  Effect.flatMap(decodeState),
                  Effect.map(({ state }): ConfirmState => state)
                )
              : Effect.succeed<ConfirmState>("invalid")
          ),
          Effect.catchCause(() => Effect.succeed<ConfirmState>("invalid"))
        );
      });

      return {
        confirm: (token: string) =>
          call(CONFIRM_PATH, token).pipe(
            Effect.map((state) => (state === "pending" ? "invalid" : state))
          ),
        state: (token: string) => call(TOKEN_STATE_PATH, token),
      };
    })
  );
