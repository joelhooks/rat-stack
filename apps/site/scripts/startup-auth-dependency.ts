import { Schema } from "effect";

export class PublicAuthBundleLeak extends Schema.TaggedError<
  PublicAuthBundleLeak,
  { readonly brand: unique symbol }
>()("PublicAuthBundleLeak", {
  modules: Schema.Array(Schema.String),
}) {
  override get message() {
    return `Mischief's startup bundle includes auth modules: ${this.modules.join(", ")}. The public Worker must not ship Better Auth, which lives in the private LearnFeedbackAuth Worker. Fix: remove the static import that reaches \`packages/auth\` or \`better-auth\` from \`apps/site/src/worker.ts\`, and call auth through its service binding.`;
  }
}
