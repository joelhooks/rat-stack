import * as Schema from "effect/Schema";

export class WebsiteContentManifestError extends Schema.TaggedError<
  WebsiteContentManifestError,
  { readonly brand: unique symbol }
>()("WebsiteContentManifestError", {
  cause: Schema.Defect(),
  path: Schema.String,
}) {
  override get message() {
    return `Website content manifest is missing or invalid at ${this.path}. Run pnpm --filter @rat-stack/site generate or pnpm build before planning or testing infrastructure.`;
  }
}
