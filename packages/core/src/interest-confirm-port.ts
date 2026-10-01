import { Context, Effect, Layer } from "effect";

export type ConfirmState = "confirmed" | "expired" | "invalid" | "pending";

export class DrovrConfirm extends Context.Service<
  DrovrConfirm,
  {
    readonly confirm: (
      token: string
    ) => Effect.Effect<Exclude<ConfirmState, "pending">>;
    readonly state: (token: string) => Effect.Effect<ConfirmState>;
  }
>()("@rat-stack/core/DrovrConfirm") {
  static readonly unconfigured = Layer.succeed(this, {
    confirm: () => Effect.succeed("invalid" as const),
    state: () => Effect.succeed("invalid" as const),
  });
}
