import { Schema } from "effect";

import { SandboxDiagnostic } from "./sandbox-diagnostic-schema.js";

export class SandboxError extends Schema.TaggedError<SandboxError>()(
  "SandboxError",
  {
    diagnostic: Schema.optional(SandboxDiagnostic),
    logs: Schema.Array(Schema.String),
    message: Schema.String,
    reason: Schema.Literals(["exited", "protocol", "threw", "timeout"]),
  }
) {}
