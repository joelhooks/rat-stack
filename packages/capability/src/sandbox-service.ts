import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";

import type { SandboxDiagnosticData } from "./sandbox-diagnostic.js";
import type { SandboxError } from "./sandbox-error.js";

export { SandboxDiagnostic } from "./sandbox-diagnostic.js";

export { sandboxRunner } from "./sandbox-result.js";

export { SandboxError } from "./sandbox-error.js";

export type InvokeOutcome =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly error: unknown;
      readonly diagnostic?: SandboxDiagnosticData;
    };

export { invokeFailure } from "./sandbox-invoke.js";

export type Invoke = (
  name: string,
  input: Schema.Json
) => Effect.Effect<InvokeOutcome>;

export interface SandboxRun {
  readonly result: unknown;
  readonly logs: readonly string[];
  readonly diagnostic?: SandboxDiagnosticData | null;
  readonly toolCalls?: readonly string[];
}

export class Sandbox extends Context.Service<
  Sandbox,
  {
    readonly run: (
      code: string,
      invoke: Invoke,
      names?: readonly string[]
    ) => Effect.Effect<SandboxRun, SandboxError>;
  }
>()("@rat-stack/capability/Sandbox") {}
