import { Schema } from "effect";

import { refusalMessage, RefusalReasonSchema } from "./refusals.js";

export class RollbackRefused extends Schema.TaggedError<
  RollbackRefused,
  { readonly brand: unique symbol }
>()("RollbackRefused", { reason: RefusalReasonSchema }) {
  override get message() {
    return refusalMessage(this.reason, "Rollback");
  }
}
