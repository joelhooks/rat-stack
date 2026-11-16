import {
  HelpListQuery,
  NewHelpReport,
} from "@rat-stack/core/tokenmaxx-help-store";
import { Schema } from "effect";

export const expiringRetentionMillis = 3000;

export const fixtureLimits = { perAttendeePerDay: 3, total: 6 } as const;

export const DeskCommand = Schema.TaggedUnion({
  Answer: { answer: Schema.String, reportId: Schema.String },
  File: { report: NewHelpReport },
  Find: { reportId: Schema.String },
  List: { query: HelpListQuery },
});

export const DeskRequest = Schema.Struct({
  command: DeskCommand,
  desk: Schema.Literals(["expiring", "limited"]),
  instance: Schema.String,
});
