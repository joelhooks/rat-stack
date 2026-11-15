import { Context, Effect, Layer } from "effect";

import type { AssetReadError } from "./asset-read-error.js";
import type { GuideRow } from "./tokenmaxx-help-guide.js";

export class SetupHelpGuide extends Context.Service<
  SetupHelpGuide,
  {
    readonly rows: Effect.Effect<
      readonly (typeof GuideRow.Type)[],
      AssetReadError
    >;
  }
>()("rat-stack/SetupHelpGuide") {
  static readonly layer = (rows: readonly (typeof GuideRow.Type)[]) =>
    Layer.succeed(SetupHelpGuide, { rows: Effect.succeed(rows) });
}
