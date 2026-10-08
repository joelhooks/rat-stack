import { Context } from "effect";

import type { AuthInstance } from "./auth-options.js";

// @effect-diagnostics-next-line leakingRequirements:off -- Better Auth intentionally retains per-request RuntimeContext requirements.
export class AuthService extends Context.Service<AuthService, AuthInstance>()(
  "@rat-stack/auth/Auth"
) {}
