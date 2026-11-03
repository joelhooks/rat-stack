import { Effect, Schema } from "effect";

export class StartupBuildDependency extends Schema.TaggedError<
  StartupBuildDependency,
  { readonly brand: unique symbol }
>()("StartupBuildDependency", { modules: Schema.Array(Schema.String) }) {
  override get message() {
    return `A Worker startup bundle includes build-only modules: ${this.modules.join(", ")}. Markdown rendering, code snippets, and Shiki run at content build time and would bloat every cold start. Fix: move the import into a build script under \`apps/site/scripts\` and read its generated output from \`apps/site/src\`.`;
  }
}

export const assertBuildOnlyModules = (modules: readonly string[]) => {
  const forbidden = modules.filter(
    (module) =>
      module.includes("/@foldkit/markdown/") ||
      module.includes("/@foldkit+markdown@") ||
      module.includes("/code-snippets/") ||
      module.includes("/shiki/") ||
      module.includes("/shiki@") ||
      module.includes("/@shikijs/")
  );

  return forbidden.length === 0
    ? Effect.void
    : Effect.fail(new StartupBuildDependency({ modules: forbidden }));
};
