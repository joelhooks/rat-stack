import { Effect, Schema } from "effect";

export class StartupBuildDependency extends Schema.TaggedError<StartupBuildDependency>()(
  "StartupBuildDependency",
  { modules: Schema.Array(Schema.String) }
) {}

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
