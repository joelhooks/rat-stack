import * as Schema from "effect/Schema";

/**
 * The toy job's result: statistics about the input fixture. Stored as
 * `JSON.stringify({ lines, words, bytes }) + "\n"`, keys in that order, so the
 * fixture `oak\npine\n` gives `{"lines":2,"words":2,"bytes":9}\n`.
 */
export const Stats = Schema.Struct({
  lines: Schema.Number,
  words: Schema.Number,
  bytes: Schema.Number,
});
export type Stats = typeof Stats.Type;

/**
 * `lines` counts `\n`-terminated lines (`oak\npine\n` has 2; reporting 3 is
 * the workshop's planted mistake), `words` counts whitespace-separated
 * tokens, and `bytes` is the input's UTF-8 length.
 */
export function countStats(text: string): Stats {
  return {
    lines: text.split("\n").length - 1,
    words: text.split(/\s+/).filter((word) => word !== "").length,
    bytes: new TextEncoder().encode(text).byteLength,
  };
}

export function encodeStats(stats: Stats): string {
  const { lines, words, bytes } = stats;
  return `${JSON.stringify({ lines, words, bytes })}\n`;
}

const decodeStatsJson = Schema.decodeUnknownSync(Schema.fromJsonString(Stats));

/** Parses result bytes back into `Stats`. Throws on anything else. */
export function decodeStats(text: string): Stats {
  return decodeStatsJson(text.trimEnd());
}

export function formatStats(stats: Stats): string {
  return `lines ${stats.lines}, words ${stats.words}, bytes ${stats.bytes}`;
}
