import { Context } from "effect";
import type { Effect, Schema } from "effect";

import type { FlagAtomicityRequired } from "./flag-atomicity-required.js";
import type { FlagFlipRefused } from "./flag-flip-refused.js";
import type {
  FlagPosition,
  FlagReceipt,
  FlipFlagInput,
  RecordFlagEvidenceInput,
} from "./flag-ladder.js";
import type { FlagScopeMismatch } from "./flag-scope-mismatch.js";
import type { FlagStorageError } from "./flag-storage-error.js";
import type { InvalidFlagValue } from "./invalid-flag-value.js";
import type { UnknownFlag } from "./unknown-flag.js";

type FlagLedgerFailure =
  | FlagAtomicityRequired
  | FlagStorageError
  | UnknownFlag
  | InvalidFlagValue
  | FlagScopeMismatch
  | FlagFlipRefused;

export class FlagLedger extends Context.Service<
  FlagLedger,
  {
    readonly read: (
      name: string,
      scope?: Schema.Json
    ) => Effect.Effect<typeof FlagPosition.Type, FlagLedgerFailure>;
    readonly flip: (
      input: typeof FlipFlagInput.Type,
      actor?: string
    ) => Effect.Effect<typeof FlagReceipt.Type, FlagLedgerFailure>;
    readonly recordEvidence: (
      input: typeof RecordFlagEvidenceInput.Type,
      actor?: string
    ) => Effect.Effect<void, FlagLedgerFailure>;
  }
>()("@rat-stack/core/FlagLedger") {}
