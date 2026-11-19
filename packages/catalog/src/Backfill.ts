import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ItemId } from "./Item/Item.id.ts";
import type { Sighting } from "./Item/Sighting.ts";

const FileKind = Schema.Literals(["github", "x", "youtube", "decisions"]);

const decodeFileKind = Schema.decodeUnknownOption(FileKind);

export interface BackfillFile {
  readonly name: string;
  readonly kind: typeof FileKind.Type;
  readonly observedAt: DateTime.Utc;
  readonly run: "am" | "pm";
}

export const backfillFile = (name: string) => {
  const groups =
    /^(?<date>\d{4}-\d{2}-\d{2})(?<evening>-pm)?-(?<kind>[a-z]+)\.jsonl$/u.exec(
      name
    )?.groups;

  const date = groups?.date;
  const kind = decodeFileKind(groups?.kind);
  const observedAt = DateTime.make(`${date}T00:00:00Z`);

  if (
    Option.isNone(kind) ||
    Option.isNone(observedAt) ||
    DateTime.formatIsoDateUtc(observedAt.value) !== date
  ) {
    return null;
  }

  return {
    name,
    kind: kind.value,
    observedAt: observedAt.value,
    run: groups?.evening === undefined ? "am" : "pm",
  } satisfies BackfillFile;
};

const phase = (file: BackfillFile) => (file.kind === "decisions" ? 1 : 0);

const runOrder = (file: BackfillFile) => (file.run === "am" ? 0 : 1);

export const sortBackfillFiles = (files: readonly BackfillFile[]) =>
  files.toSorted(
    (left, right) =>
      phase(left) - phase(right) ||
      DateTime.toEpochMillis(left.observedAt) -
        DateTime.toEpochMillis(right.observedAt) ||
      runOrder(left) - runOrder(right) ||
      left.name.localeCompare(right.name)
  );

const Repo = Schema.String.check(
  Schema.isPattern(/^[\da-z_-]+\/(?!\.{1,2}$)[\da-z_.-]+$/iu)
);

const Handle = Schema.String.check(Schema.isPattern(/^[\da-z_]+$/iu));

const StatusId = Schema.String.check(Schema.isPattern(/^\d+$/u));

const Measurement = Schema.optionalKey(Schema.NullOr(Schema.Natural));

const GitHubRow = Schema.Struct({
  kind: Schema.Literal("github"),
  repo: Repo,
  stars: Measurement,
});

const XRow = Schema.Struct({
  kind: Schema.Literal("x"),
  author: Handle,
  id: StatusId,
  metrics: Schema.Struct({
    like_count: Measurement,
    impression_count: Measurement,
  }),
});

const YouTubeRow = Schema.Struct({
  url: Schema.NonEmptyString,
  channel: Schema.optionalKey(Schema.NullOr(Schema.NonEmptyString)),
  views: Measurement,
});

const DecisionRow = Schema.Union([
  Schema.Struct({
    id: Schema.String.check(Schema.isPattern(/^(?:monitor|x):/u)),
  }),
  Schema.Struct({
    id: Schema.NonEmptyString,
    source: Schema.NonEmptyString,
    decision: Schema.Literals(["kept", "dropped"]),
    why: Schema.NonEmptyString,
  }),
]);

const decodeGitHub = Schema.decodeUnknownOption(
  Schema.fromJsonString(GitHubRow)
);

const decodeX = Schema.decodeUnknownOption(Schema.fromJsonString(XRow));

const decodeYouTube = Schema.decodeUnknownOption(
  Schema.fromJsonString(YouTubeRow)
);

const decodeDecision = Schema.decodeUnknownOption(
  Schema.fromJsonString(DecisionRow)
);

const decodeItemId = Schema.decodeUnknownOption(ItemId);

const canonicalItem = (value: string) => {
  if (!URL.canParse(value)) {
    return Option.none();
  }

  const url = new URL(value);
  url.hash = "";

  return decodeItemId(url.href);
};

interface CommandIdentity {
  readonly item: typeof ItemId.Type;
  readonly commandId: string;
}

export type BackfillCommand = CommandIdentity &
  (
    | { readonly tag: "RecordSighting"; readonly input: typeof Sighting.Type }
    | {
        readonly tag: "Keep" | "Drop";
        readonly input: { readonly why: string };
      }
  );

type DecodedLine =
  | { readonly tag: "malformed" | "groupKey" }
  | { readonly tag: "command"; readonly command: BackfillCommand };

const malformed = { tag: "malformed" } satisfies DecodedLine;

const sighting = (
  itemUrl: string,
  commandId: string,
  input: typeof Sighting.Type
): DecodedLine => {
  const item = canonicalItem(itemUrl);

  return Option.isNone(item)
    ? malformed
    : {
        tag: "command",
        command: { item: item.value, commandId, tag: "RecordSighting", input },
      };
};

const decisionCommand = (line: string, commandId: string): DecodedLine => {
  const row = decodeDecision(line);

  if (Option.isNone(row)) {
    return malformed;
  }

  if (!("decision" in row.value)) {
    return { tag: "groupKey" };
  }

  const { id, decision, why } = row.value;
  const item = canonicalItem(id);

  return Option.isNone(item)
    ? malformed
    : {
        tag: "command",
        command: {
          item: item.value,
          commandId,
          tag: decision === "kept" ? "Keep" : "Drop",
          input: { why },
        },
      };
};

export const decodeBackfillLine = (
  file: BackfillFile,
  lineNumber: number,
  line: string
): DecodedLine => {
  const commandId = `cafe-backfill:v1:${file.name}:${lineNumber}`;
  const origin = { observedAt: file.observedAt, source: file.kind };

  switch (file.kind) {
    case "github": {
      const row = decodeGitHub(line);

      if (Option.isNone(row)) {
        return malformed;
      }

      const { repo } = row.value;
      const stars = row.value.stars ?? undefined;

      return sighting(`https://github.com/${repo}`, commandId, {
        ...origin,
        kind: "repo",
        metrics: stars === undefined ? {} : { stars },
      });
    }

    case "x": {
      const row = decodeX(line);

      if (Option.isNone(row)) {
        return malformed;
      }

      const { author, id } = row.value;
      const likes = row.value.metrics.like_count ?? undefined;
      const views = row.value.metrics.impression_count ?? undefined;
      const withLikes = likes === undefined ? {} : { likes };

      return sighting(`https://x.com/${author}/status/${id}`, commandId, {
        ...origin,
        kind: "post",
        author,
        metrics: views === undefined ? withLikes : { ...withLikes, views },
      });
    }

    case "youtube": {
      const row = decodeYouTube(line);

      if (Option.isNone(row)) {
        return malformed;
      }

      const { url, channel } = row.value;
      const views = row.value.views ?? undefined;

      return sighting(url, commandId, {
        ...origin,
        kind: "video",
        author: channel ?? undefined,
        metrics: views === undefined ? {} : { views },
      });
    }

    case "decisions": {
      return decisionCommand(line, commandId);
    }

    default: {
      return malformed;
    }
  }
};
