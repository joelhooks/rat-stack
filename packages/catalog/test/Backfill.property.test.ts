import { expect, it } from "@effect/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { backfillFile, decodeBackfillLine } from "../src/Backfill.ts";

it.prop(
  "maps each supported row to one typed, stable command without carrying discarded fields",
  {
    count: Arbitrary.schema(Schema.Natural.check(Schema.isLessThan(10_000))),
    decision: Arbitrary.schema(Schema.Literals(["kept", "dropped"])),
    reason: Arbitrary.schema(Schema.NonEmptyString),
  },
  ({ count, decision, reason }) => {
    const repo = `example/fixture-${count}`;
    const repoUrl = `https://github.com/${repo}`;
    const videoUrl = `https://example.test/watch?v=${count}`;
    const day = "2026-01-05";
    const observedAt = DateTime.makeUnsafe(`${day}T00:00:00Z`);

    for (const { kind, row, target, operation, input } of [
      {
        kind: "github",
        row: { kind: "github", repo, stars: count, created: "2025-01-01" },
        target: repoUrl,
        operation: "RecordSighting",
        input: {
          kind: "repo",
          source: "github",
          observedAt,
          metrics: { stars: count },
        },
      },
      {
        kind: "x",
        row: {
          kind: "x",
          id: `${count}`,
          author: "Example",
          metrics: { like_count: count, bookmark_count: 12 },
          text: "Synthetic private text",
        },
        target: `https://x.com/Example/status/${count}`,
        operation: "RecordSighting",
        input: {
          kind: "post",
          source: "x",
          observedAt,
          author: "Example",
          metrics: { likes: count },
        },
      },
      {
        kind: "youtube",
        row: {
          url: `${videoUrl}#comment`,
          channel: "Example TV",
          views: count,
        },
        target: videoUrl,
        operation: "RecordSighting",
        input: {
          kind: "video",
          source: "youtube",
          observedAt,
          author: "Example TV",
          metrics: { views: count },
        },
      },
      {
        kind: "decisions",
        row: {
          id: `${repoUrl}#readme`,
          source: "github",
          decision,
          why: reason,
          row: { repo },
        },
        target: repoUrl,
        operation: decision === "kept" ? "Keep" : "Drop",
        input: { why: reason },
      },
    ]) {
      const name = `${day}-${kind}.jsonl`;
      const file = backfillFile(name);

      if (file === null) {
        expect.fail(`Known filename was not accepted: ${name}`);
      }

      const line = JSON.stringify(row);
      const first = decodeBackfillLine(file, 2, line);

      if (first.tag !== "command") {
        expect.fail(`Known row did not yield a command: ${kind}`);
      }

      const { commandId, ...payload } = first.command;
      expect(commandId).not.toBe("");
      expect(payload).toEqual({ tag: operation, item: target, input });
      expect(decodeBackfillLine(file, 2, line)).toEqual(first);
      expect(decodeBackfillLine(file, 3, line)).not.toEqual(first);
    }
  }
);
