import { Schema } from "effect";

import { SandboxDiagnostic } from "./sandbox-diagnostic-schema.js";
import { SandboxError } from "./sandbox-error.js";

export class ExecuteError extends Schema.TaggedError<
  ExecuteError,
  { readonly brand: unique symbol }
>()(
  "ExecuteError",
  {
    ...SandboxDiagnostic.fields,
    logs: Schema.Array(Schema.String),
    toolCalls: Schema.Array(Schema.String),
    truncated: Schema.Boolean,
  },
  { httpApiStatus: 422 }
) {}

export const ExecuteFailure = Schema.Union([SandboxError, ExecuteError]);
