import { Approval } from "@rat-stack/capability/approval";
import { aroundHandlers, implement } from "@rat-stack/capability/implement";
import { Effect, Predicate } from "effect";

import { auditFlagRun } from "./flag-audit.js";
import {
  flipFeatureFlagContract,
  recordFlagEvidenceContract,
  readFlagLedgerContract,
} from "./flag-contracts.js";
import { FlagActor, FlagJournal } from "./flag-control.js";
import { scopeKey } from "./flag-ladder.js";
import { FlagLedger } from "./flag-ledger.js";

const approvedFlip = implement(flipFeatureFlagContract, (input) =>
  Effect.gen(function* flipApprovedRung() {
    const ledger = yield* FlagLedger;

    return yield* ledger.flip(input, yield* FlagActor);
  })
);

const [auditedFlip] = aroundHandlers([approvedFlip] as const, auditFlagRun);

export const flipFeatureFlag = {
  ...auditedFlip,
  handler: (input: typeof flipFeatureFlagContract.input.Type) =>
    Predicate.isTagged(input.target, "off")
      ? auditedFlip
          .handler(input)
          .pipe(Effect.provideService(Approval, { approve: () => Effect.void }))
      : auditedFlip.handler(input),
};

const evidence = implement(recordFlagEvidenceContract, (input) =>
  Effect.gen(function* recordScopedEvidence() {
    const ledger = yield* FlagLedger;

    return yield* ledger.recordEvidence(input, yield* FlagActor);
  })
);

export const [recordFlagEvidence] = aroundHandlers(
  [evidence] as const,
  auditFlagRun
);

export const readFlagLedger = implement(readFlagLedgerContract, (input) =>
  Effect.gen(function* readScopedLedger() {
    const ledger = yield* FlagLedger;
    const journal = yield* FlagJournal;
    const position = yield* ledger.read(input.name, input.scope);
    const page = yield* journal.list(input);

    return {
      ...page,
      changes: page.changes.filter(
        (entry) =>
          entry.name === input.name &&
          scopeKey(entry.scope ?? "global") ===
            scopeKey(input.scope ?? "global")
      ),
      position,
    };
  })
);

export const flagWriteCapabilities = [
  flipFeatureFlag,
  recordFlagEvidence,
  readFlagLedger,
] as const;
