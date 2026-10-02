export {
  CodeRequest,
  RangeSchema,
  codeLineCap,
  codeIdentity,
  sourceLines,
  errorContext,
  normalizeCodeLanguage,
  TokenSchema,
  SnippetLine,
} from "./model.ts";

export type { CodeFence, Range, Token } from "./model.ts";

export { CodeSnippet } from "./stages/code-snippet.ts";

export { HighlightedFile } from "./stages/highlighted-file.ts";

export { ResolvedCode } from "./stages/resolved-code.ts";

export { parseCodeRequest, printCodeRequest } from "./scanner.ts";

export {
  CodeBuildFailed,
  CodeInvalidProps,
  CodeUnknownRepo,
  CodeMissingCommit,
  CodeMissingPath,
  CodeRangeOutOfBounds,
  CodeInvalidRanges,
  CodeHighlightOutsideRanges,
  UnknownLanguage,
  CodeSourceUnavailable,
  CodeLineCapExceeded,
  CodeHighlightFailed,
  CodeUnknownKey,
  CodeDuplicateKey,
  CodeMalformedMeta,
  CodeBodyWithReference,
  formatCodeError,
} from "./errors.ts";

export type { CodeError } from "./errors.ts";

export {
  Drift,
  Highlighter,
  SourceRepository,
  RepositorySchema,
  RepositoryRegistry,
  CodeRepositoryConfigInvalid,
  HighlightFault,
  SourceFault,
  decodeRepositories,
} from "./ports.ts";

export {
  codeContentKey,
  shownLineNumbers,
  decorateCode,
  renderCode,
  prepareCode,
} from "./pipeline.ts";

export type { FenceJob } from "./pipeline.ts";

export type { Diagnostics } from "./drift.ts";
