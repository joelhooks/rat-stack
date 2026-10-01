import { Context } from "effect";
import type { Effect } from "effect";

export class VisitorSalt extends Context.Service<
  VisitorSalt,
  { readonly salt: Effect.Effect<string> }
>()("@rat-stack/events/VisitorSalt") {}
