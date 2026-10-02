import { Schema } from "effect";

export class IntakeApplicationsUnavailable extends Schema.TaggedError<IntakeApplicationsUnavailable>()(
  "IntakeApplicationsUnavailable",
  {}
) {}
