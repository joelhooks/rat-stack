import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";

import type { SandboxDiagnosticData } from "./sandbox-diagnostic-schema.js";
import type { SandboxError } from "./sandbox-error.js";
import type { SandboxLimits } from "./sandbox-limits-schema.js";

export { resolveLimits } from "./sandbox-limits-schema.js";

export type InvokeOutcome =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly error: unknown;
      readonly diagnostic?: SandboxDiagnosticData;
    };

export type Invoke = (
  name: string,
  input: Schema.Json
) => Effect.Effect<InvokeOutcome>;

export interface SandboxRun {
  readonly result: unknown;
  readonly logs: readonly string[];
  readonly diagnostic?: SandboxDiagnosticData | null;
  readonly toolCalls?: readonly string[];
  readonly truncated?: boolean;
}

export class Sandbox extends Context.Service<
  Sandbox,
  {
    readonly run: (
      code: string,
      invoke: Invoke,
      names?: readonly string[],
      limits?: SandboxLimits
    ) => Effect.Effect<SandboxRun, SandboxError>;
  }
>()("@rat-stack/capability/Sandbox") {}
