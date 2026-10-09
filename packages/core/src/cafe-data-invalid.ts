import { Schema } from "effect";

import { CafeDataError } from "./cafe-data-error.js";

export class CafeDataInvalid extends Schema.TaggedError<CafeDataInvalid>()(
  "CafeDataInvalid",
  {
    errors: Schema.Array(CafeDataError),
    message: Schema.String,
  }
) {}
