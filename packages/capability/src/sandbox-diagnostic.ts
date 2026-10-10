import { Option, Schema } from "effect";

import type { SandboxDiagnosticData } from "./sandbox-diagnostic-schema.js";

export { SandboxDiagnostic } from "./sandbox-diagnostic-schema.js";

export type { SandboxDiagnosticData } from "./sandbox-diagnostic-schema.js";

export const modelSafeMessage = (message: string): string =>
  message
    .replaceAll(
      /\/(?:Users|home|private|tmp|var\/folders)\/[^\s"'`]+/gu,
      "<redacted-path>"
    )
    .slice(0, 512);

const FailureInfo = Schema.Struct({
  _tag: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.String),
});

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Capability failures arrive erased at this schema-decoding boundary.
export const toolDiagnostic = (failure: unknown): SandboxDiagnosticData =>
  Option.match(Schema.decodeUnknownOption(FailureInfo)(failure), {
    onNone: () => ({
      kind: "ToolFailure",
      message: "Capability execution failed",
    }),
    onSome: ({ _tag, message }) => ({
      kind: "ToolFailure",
      message: modelSafeMessage(
        message ?? `Capability failed${_tag === undefined ? "" : ` (${_tag})`}`
      ),
      tag: _tag,
    }),
  });
