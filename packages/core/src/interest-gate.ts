import { Context } from "effect";
import type { Effect } from "effect";

export class InterestGate extends Context.Service<
  InterestGate,
  { readonly allow: (ip: string) => Effect.Effect<boolean> }
>()("@rat-stack/core/InterestGate") {}
