import { Match } from "effect";

import { modelSafeMessage } from "./sandbox-diagnostic.js";
import type { InvokeOutcome } from "./sandbox-service.js";

export const invokeFailure = (tag: string, message: string): InvokeOutcome => ({
  diagnostic: {
    kind: Match.value(tag).pipe(
      Match.when("UnknownCapability", () => "UnknownTool" as const),
      Match.when("InvalidInput", () => "InvalidToolInput" as const),
      Match.when("UnencodableOutput", () => "InvalidToolOutput" as const),
      Match.orElse(() => "ToolFailure" as const)
    ),
    message: modelSafeMessage(message),
    tag,
  },
  error: { _tag: tag, message: modelSafeMessage(message) },
  ok: false,
});
