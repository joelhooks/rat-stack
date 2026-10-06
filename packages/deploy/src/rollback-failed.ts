import { Schema } from "effect";

import { RollbackReceiptSchema } from "./rollback-contracts.js";

export class RollbackFailed extends Schema.TaggedError<RollbackFailed>()(
  "RollbackFailed",
  { receipt: RollbackReceiptSchema }
) {}
