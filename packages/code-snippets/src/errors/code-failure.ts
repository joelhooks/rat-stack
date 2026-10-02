import { Schema } from "effect";

import { CodeBodyWithReference } from "./code-body-with-reference.ts";
import { CodeDuplicateKey } from "./code-duplicate-key.ts";
import { CodeHighlightFailed } from "./code-highlight-failed.ts";
import { CodeHighlightOutsideRanges } from "./code-highlight-outside-ranges.ts";
import { CodeInvalidProps } from "./code-invalid-props.ts";
import { CodeInvalidRanges } from "./code-invalid-ranges.ts";
import { CodeLineCapExceeded } from "./code-line-cap-exceeded.ts";
import { CodeMalformedMeta } from "./code-malformed-meta.ts";
import { CodeMissingCommit } from "./code-missing-commit.ts";
import { CodeMissingPath } from "./code-missing-path.ts";
import { CodeRangeOutOfBounds } from "./code-range-out-of-bounds.ts";
import { CodeSourceUnavailable } from "./code-source-unavailable.ts";
import { CodeUnknownKey } from "./code-unknown-key.ts";
import { CodeUnknownRepo } from "./code-unknown-repo.ts";
import { SourceFetchMissingCommit } from "./source-fetch-missing-commit.ts";
import { SourceFetchOffline } from "./source-fetch-offline.ts";
import { SourceFetchUnknownRemote } from "./source-fetch-unknown-remote.ts";
import { UnknownLanguage } from "./unknown-language.ts";

export const CodeFailure = Schema.Union([
  CodeBodyWithReference,
  CodeDuplicateKey,
  CodeHighlightFailed,
  CodeHighlightOutsideRanges,
  CodeInvalidProps,
  CodeInvalidRanges,
  CodeLineCapExceeded,
  CodeMalformedMeta,
  CodeMissingCommit,
  CodeMissingPath,
  CodeRangeOutOfBounds,
  CodeSourceUnavailable,
  CodeUnknownKey,
  CodeUnknownRepo,
  UnknownLanguage,
  SourceFetchMissingCommit,
  SourceFetchOffline,
  SourceFetchUnknownRemote,
]);
