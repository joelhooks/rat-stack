import {
  ContactRefSchema,
  IntakeObjectSchema,
  IntakeVerbSchema,
} from "@rat-stack/core/intake";
import type {
  ContactRef,
  IntakeContact,
  IntakeStatement,
} from "@rat-stack/core/intake";
import { Schema } from "effect";

export const INTAKE_TABLE = "intake_raw";

export const IntakeRowSourceSchema = Schema.Literals(["live", "backfill"]);

export type IntakeRowSource = typeof IntakeRowSourceSchema.Type;

const rowFields = {
  actor: ContactRefSchema,
  id: Schema.String,
  intake: Schema.Literal("tokenmaxx"),
  recordedAt: Schema.String,
  source: IntakeRowSourceSchema,
  timestamp: Schema.String,
  v: Schema.Literal(1),
};

export const IntakeStatementRowSchema = Schema.Struct({
  ...rowFields,
  kind: Schema.Literal("statement"),
  object: IntakeObjectSchema,
  result: Schema.optionalKey(Schema.Json),
  submissionId: Schema.String,
  verb: IntakeVerbSchema,
});

export const IntakeContactRowSchema = Schema.Struct({
  ...rowFields,
  agentRef: Schema.String,
  email: Schema.String,
  kind: Schema.Literal("contact"),
  submissionId: Schema.String,
});

export const IntakeErasedRowSchema = Schema.Struct({
  ...rowFields,
  kind: Schema.Literal("erased"),
});

export const IntakeRowSchema = Schema.Union([
  IntakeStatementRowSchema,
  IntakeContactRowSchema,
  IntakeErasedRowSchema,
]);

export type IntakeRow = typeof IntakeRowSchema.Type;

export interface RowStamp {
  readonly recordedAt: string;
  readonly source: IntakeRowSource;
}

export const contactRowId = (submissionId: string) => `contact:${submissionId}`;

export const erasedRowId = (actor: ContactRef) => `erased:${actor}`;

const statementRow = (statement: IntakeStatement, stamp: RowStamp) => {
  const row = {
    actor: statement.actor,
    id: statement.id,
    intake: statement.context.intake,
    kind: "statement",
    object: statement.object,
    recordedAt: stamp.recordedAt,
    source: stamp.source,
    submissionId: statement.context.submissionId,
    timestamp: statement.timestamp,
    v: 1,
    verb: statement.verb,
  } as const;

  return statement.result === undefined
    ? row
    : { ...row, result: statement.result };
};

export const recordRows = (
  statements: readonly IntakeStatement[],
  contact: IntakeContact | undefined,
  stamp: RowStamp
): readonly IntakeRow[] => {
  const rows: IntakeRow[] = statements.map((statement) =>
    statementRow(statement, stamp)
  );

  const [first] = statements;

  if (contact === undefined || first === undefined) {
    return rows;
  }

  return [
    ...rows,
    {
      actor: first.actor,
      agentRef: contact.agentRef,
      email: contact.email,
      id: contactRowId(first.context.submissionId),
      intake: first.context.intake,
      kind: "contact",
      recordedAt: stamp.recordedAt,
      source: stamp.source,
      submissionId: first.context.submissionId,
      timestamp: first.timestamp,
      v: 1,
    },
  ];
};

export const erasedRow = (actor: ContactRef, stamp: RowStamp): IntakeRow => ({
  actor,
  id: erasedRowId(actor),
  intake: "tokenmaxx",
  kind: "erased",
  recordedAt: stamp.recordedAt,
  source: stamp.source,
  timestamp: stamp.recordedAt,
  v: 1,
});
