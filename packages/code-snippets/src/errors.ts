import type { CodeBodyWithReference } from "./errors/code-body-with-reference.ts";
import type { CodeDuplicateKey } from "./errors/code-duplicate-key.ts";
import type { CodeHighlightFailed } from "./errors/code-highlight-failed.ts";
import type { CodeHighlightOutsideRanges } from "./errors/code-highlight-outside-ranges.ts";
import type { CodeInvalidProps } from "./errors/code-invalid-props.ts";
import type { CodeInvalidRanges } from "./errors/code-invalid-ranges.ts";
import type { CodeLineCapExceeded } from "./errors/code-line-cap-exceeded.ts";
import type { CodeMalformedMeta } from "./errors/code-malformed-meta.ts";
import type { CodeMissingCommit } from "./errors/code-missing-commit.ts";
import type { CodeMissingPath } from "./errors/code-missing-path.ts";
import type { CodeRangeOutOfBounds } from "./errors/code-range-out-of-bounds.ts";
import type { CodeSourceUnavailable } from "./errors/code-source-unavailable.ts";
import type { CodeUnknownKey } from "./errors/code-unknown-key.ts";
import type { CodeUnknownRepo } from "./errors/code-unknown-repo.ts";
import type { UnknownLanguage } from "./errors/unknown-language.ts";

export { CodeInvalidProps } from "./errors/code-invalid-props.ts";

export { CodeUnknownRepo } from "./errors/code-unknown-repo.ts";

export { CodeMissingCommit } from "./errors/code-missing-commit.ts";

export { CodeMissingPath } from "./errors/code-missing-path.ts";

export { CodeRangeOutOfBounds } from "./errors/code-range-out-of-bounds.ts";

export { CodeInvalidRanges } from "./errors/code-invalid-ranges.ts";

export { CodeHighlightOutsideRanges } from "./errors/code-highlight-outside-ranges.ts";

export { UnknownLanguage } from "./errors/unknown-language.ts";

export { CodeSourceUnavailable } from "./errors/code-source-unavailable.ts";

export { CodeLineCapExceeded } from "./errors/code-line-cap-exceeded.ts";

export { CodeHighlightFailed } from "./errors/code-highlight-failed.ts";

export { CodeUnknownKey } from "./errors/code-unknown-key.ts";

export { CodeDuplicateKey } from "./errors/code-duplicate-key.ts";

export { CodeMalformedMeta } from "./errors/code-malformed-meta.ts";

export { CodeBodyWithReference } from "./errors/code-body-with-reference.ts";

export { CodeBuildFailed } from "./errors/code-build-failed.ts";

export type CodeError =
  | CodeInvalidProps
  | CodeUnknownRepo
  | CodeMissingCommit
  | CodeMissingPath
  | CodeRangeOutOfBounds
  | CodeInvalidRanges
  | CodeHighlightOutsideRanges
  | UnknownLanguage
  | CodeSourceUnavailable
  | CodeLineCapExceeded
  | CodeHighlightFailed
  | CodeUnknownKey
  | CodeDuplicateKey
  | CodeMalformedMeta
  | CodeBodyWithReference;

export const formatCodeError = (error: CodeError) =>
  `${error.sourcePath}:${error.line} [${error._tag}] ${error.repo}:${error.path}@${error.commit} lines=${error.ranges}; ${error.fix}`;
