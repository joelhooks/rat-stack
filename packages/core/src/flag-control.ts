import { Context, Effect, Layer } from "effect";

import { FlagJournal } from "./flag-journal.js";
import { FlagLedger } from "./flag-ledger.js";
import { FlagStorageError } from "./flag-storage-error.js";

export {
  FlagAuthority,
  FlagThreshold,
  FlagTarget,
  FlagExit,
  FlagKill,
  FlagPosition,
  FlagReceipt,
  FlagEvidence,
  FlagScopeMismatch,
  FlagFlipRefused,
  FlipFlagInput,
  RecordFlagEvidenceInput,
  flagPartition,
  scopeKey,
  validateFlagScope,
} from "./flag-ladder.js";

export { FlagLedger } from "./flag-ledger.js";

export { FlagAtomicityRequired } from "./flag-atomicity-required.js";

export {
  FlagChangeSchema,
  PendingFlagChangeSchema,
  CompletedFlagChangeSchema,
  FlagPreviousValue,
  FlagChangesPage,
  ListFlagChangesInput,
} from "./flag-change.js";

export type {
  FlagChange,
  PendingFlagChange,
  CompletedFlagChange,
} from "./flag-change.js";

export { FlagJournal, validateFlagChangeQuery } from "./flag-journal.js";

export const FlagActor = Context.Reference<string>(
  "@rat-stack/core/FlagActor",
  {
    defaultValue: () => "anonymous",
  }
);

const noLedger = (name: string) =>
  Effect.fail(
    new FlagStorageError({
      cause: "This composition has no live flag ledger.",
      fallback: null,
      name,
      operation: "write",
      repair:
        "Provide the flags cartridge's operator ledger at the child composition.",
    })
  );

export const flagControlDefaults = Layer.mergeAll(
  FlagJournal.memory,
  Layer.succeed(FlagLedger, {
    flip: (input) => noLedger(input.name),
    read: noLedger,
    recordEvidence: (input) => noLedger(input.name),
  })
);
