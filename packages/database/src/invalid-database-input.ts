import { Schema } from "effect";

import { DatabaseOperationSchema } from "./model.js";

export class InvalidDatabaseInput extends Schema.TaggedError<
  InvalidDatabaseInput,
  { readonly brand: unique symbol }
>()("InvalidDatabaseInput", {
  cause: Schema.Defect(),
  operation: DatabaseOperationSchema,
}) {}
