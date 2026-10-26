import { Schema } from "effect";

export class StartupBudgetExceeded extends Schema.TaggedError<
  StartupBudgetExceeded,
  { readonly brand: unique symbol }
>()("StartupBudgetExceeded", {
  budget: Schema.Finite,
  bytes: Schema.Finite,
  worker: Schema.String,
}) {}
