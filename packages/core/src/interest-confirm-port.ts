import { Context, Effect, Layer } from "effect";

export type ConfirmState = "confirmed" | "expired" | "invalid" | "pending";

export class SubscriberConfirm extends Context.Service<
  SubscriberConfirm,
  {
    readonly confirm: (
      token: string
    ) => Effect.Effect<Exclude<ConfirmState, "pending">>;
    readonly state: (token: string) => Effect.Effect<ConfirmState>;
  }
>()("@rat-stack/core/SubscriberConfirm") {
  static readonly unconfigured = Layer.succeed(this, {
    confirm: () => Effect.succeed("invalid" as const),
    state: () => Effect.succeed("invalid" as const),
  });
}
