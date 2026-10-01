import { Context, Layer } from "effect";

export type InterestModeName = "capture" | "doi";

export class InterestMode extends Context.Service<
  InterestMode,
  InterestModeName
>()("@rat-stack/core/InterestMode") {
  static readonly layer = (mode: InterestModeName) => Layer.succeed(this, mode);
}
