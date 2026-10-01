import { Schema } from "effect";

export const QuestionIdSchema = Schema.Literals([
  "building",
  "today",
  "leaveWith",
]);

export type QuestionId = typeof QuestionIdSchema.Type;

export const ConsentIdSchema = Schema.Literals(["contact", "share"]);

export type ConsentId = typeof ConsentIdSchema.Type;

export const IntakeAnswersSchema = Schema.Struct({
  building: Schema.optionalKey(Schema.String),
  leaveWith: Schema.optionalKey(Schema.String),
  today: Schema.optionalKey(Schema.String),
});

export type IntakeAnswers = typeof IntakeAnswersSchema.Type;
