import * as Capability from "@rat-stack/capability";
import { Effect, Schema } from "effect";

export class NoteMissing extends Schema.TaggedError<NoteMissing>()(
  "NoteMissing",
  { id: Schema.String }
) {}

export const archiveNoteContract = Capability.defineContract("archiveNote", {
  annotations: { destructive: true, idempotent: true },
  description: "Archive one note by id.",
  failure: NoteMissing,
  input: Schema.Struct({ id: Schema.String }),
  needsApproval: true,
  output: Schema.Struct({ archived: Schema.Boolean }),
});

export const archiveNote = Capability.implement(
  archiveNoteContract,
  ({ id }) =>
    id === ""
      ? Effect.fail(new NoteMissing({ id }))
      : Effect.succeed({ archived: true })
);
