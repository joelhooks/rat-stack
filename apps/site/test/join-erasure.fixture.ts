import {
  JOIN_CONTACT_RETENTION_MILLIS,
  JoinErasureSchema,
} from "@rat-stack/core/join-interest";
import type { JoinErasure } from "@rat-stack/core/join-interest";
import { Clock, DateTime, Effect, Schema } from "effect";

import type { JoinContactStub } from "../src/interest/join-contact-store.js";

type SealedStub = Pick<JoinContactStub, "joinErase" | "joinRead" | "joinSave">;

const wrapStub = (stub: SealedStub): JoinContactStub => {
  let metadata: JoinErasure | undefined;
  let marker: JoinErasure | undefined;
  let retentionDeadline: number | undefined;

  return {
    ...stub,
    joinSave: (sealed, erase, deadline, contactRef) =>
      Effect.gen(function* save() {
        const candidate =
          deadline ??
          (yield* Clock.currentTimeMillis) + JOIN_CONTACT_RETENTION_MILLIS;

        retentionDeadline = Math.min(retentionDeadline ?? candidate, candidate);

        if (metadata === undefined && contactRef !== undefined) {
          metadata = yield* Schema.decodeEffect(JoinErasureSchema)({
            contactRef,
            handedToDrovr: false,
            handedToDrovrAt: null,
            pending: "erase",
          }).pipe(Effect.orDie);
        }

        if (erase) {
          marker = metadata;
        }

        yield* stub.joinSave(sealed, erase, deadline, contactRef);
      }),
    joinReadSnapshot: () =>
      stub.joinRead().pipe(
        Effect.map((sealed) => {
          if (sealed === undefined) {
            return sealed;
          }

          return retentionDeadline === undefined
            ? { sealed }
            : { sealed, retentionDeadlineAt: retentionDeadline };
        })
      ),
    joinReadErasure: () => Effect.sync(() => marker),
    joinReadRetentionDeadline: () => Effect.sync(() => retentionDeadline),
    joinReadHandoff: () => Effect.sync(() => metadata),
    joinRequestErase: () =>
      Effect.gen(function* requestErase() {
        marker = metadata;
        yield* stub.joinErase();

        return marker;
      }),
    joinCompleteErasure: () =>
      Effect.sync(() => {
        marker = undefined;
      }),
    joinMarkHandedToDrovr: (legacy = false) =>
      Effect.gen(function* rememberHandoff() {
        if (metadata !== undefined) {
          const handedToDrovrAt =
            legacy || metadata.handedToDrovr
              ? metadata.handedToDrovrAt
              : DateTime.formatIso(yield* DateTime.now);

          metadata = { ...metadata, handedToDrovr: true, handedToDrovrAt };

          if (marker !== undefined) {
            marker = metadata;
          }
        }
      }),
  };
};

export const withMemoryErasure = (make: (id: string) => SealedStub) => {
  const stubs = new Map<string, JoinContactStub>();

  return (id: string) => {
    const held = stubs.get(id);

    if (held !== undefined) {
      return held;
    }

    const stub = wrapStub(make(id));
    stubs.set(id, stub);

    return stub;
  };
};
