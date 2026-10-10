import { Schema } from "effect";

export interface SandboxLimits {
  readonly maxToolCalls?: number | undefined;
  readonly maxOutputBytes?: number | undefined;
}

const Limits = Schema.Struct({
  maxOutputBytes: Schema.optional(Schema.Natural),
  maxToolCalls: Schema.optional(Schema.Natural),
});

export const resolveLimits = Schema.decodeSync(Limits);
