import { Schema } from "effect";

export const QuestionIdSchema = Schema.Literals([
  "building",
  "today",
  "leaveWith",
  "when",
  "format",
]);

export type QuestionId = typeof QuestionIdSchema.Type;

export const ConsentIdSchema = Schema.Literals(["contact", "share"]);

export type ConsentId = typeof ConsentIdSchema.Type;

export const IntakeAnswersSchema = Schema.Record(
  QuestionIdSchema,
  Schema.optionalKey(Schema.String)
);

export type IntakeAnswers = typeof IntakeAnswersSchema.Type;
