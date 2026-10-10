import { Schema } from "effect";

export const SandboxDiagnostic = Schema.Struct({
  kind: Schema.Literals([
    "ParseError",
    "ExecutionFailure",
    "UnknownTool",
    "InvalidToolInput",
    "InvalidToolOutput",
    "InvalidDataValue",
    "ToolFailure",
    "TimeoutExceeded",
    "ToolCallLimitExceeded",
    "HostFailure",
  ]),
  message: Schema.String,
  tag: Schema.optional(Schema.String),
});

export type SandboxDiagnosticData = typeof SandboxDiagnostic.Type;
