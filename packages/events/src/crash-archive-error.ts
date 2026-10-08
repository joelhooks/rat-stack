import { Schema } from "effect";

export class CrashArchiveError extends Schema.TaggedError<CrashArchiveError>()(
  "CrashArchiveError",
  {}
) {}
