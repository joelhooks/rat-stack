export { SourceRepository } from "./source-repository.ts";

export { Highlighter } from "./highlighter.ts";

export { Drift, DiagnosticsSchema } from "./drift.ts";

export type { Diagnostics } from "./drift.ts";

export { SourceFault } from "./errors/source-fault.ts";

export { HighlightFault } from "./errors/highlight-fault.ts";

export { CodeRepositoryConfigInvalid } from "./errors/code-repository-config-invalid.ts";

export {
  RepositorySchema,
  RepositoryRegistry,
  decodeRepositories,
  sourceLink,
} from "./repositories.ts";

export type { Repository } from "./repositories.ts";
