import { Schema } from "effect";

export class StartupBudgetExceeded extends Schema.TaggedError<
  StartupBudgetExceeded,
  { readonly brand: unique symbol }
>()("StartupBudgetExceeded", {
  budget: Schema.Finite,
  bytes: Schema.Finite,
  worker: Schema.String,
}) {
  override get message() {
    return `${this.worker} static startup is ${this.bytes} bytes, over its shrink-only ceiling of ${this.budget} bytes. Every startup byte is parsed before the Worker serves its first request, and the ceiling never rises to accept growth. Fix: move the new code behind a dynamic import or into static assets, then rerun \`pnpm --filter @rat-stack/site startup:check\`; \`apps/site/STARTUP.md\` shows how to profile it.`;
  }
}
