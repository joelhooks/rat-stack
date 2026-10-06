import { Schema } from "effect";

export const SpecIssue = Schema.Struct({
  kind: Schema.Literals([
    "UnknownComponent",
    "InvalidProps",
    "MissingChild",
    "Cycle",
    "Orphan",
    "MultipleCallouts",
    "InvalidSpec",
  ]),
  message: Schema.String,
  path: Schema.String,
});

export class InvalidPage extends Schema.TaggedError<InvalidPage>()(
  "InvalidPage",
  { issues: Schema.Array(SpecIssue) }
) {}
