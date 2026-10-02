import { Schema } from "effect";

export interface CodeFence {
  readonly lang?: string | null | undefined;
  readonly meta?: string | null | undefined;
  readonly value: string;
  readonly line: number;
}

export const RangeSchema = Schema.Struct({
  end: Schema.Int.check(Schema.isGreaterThan(0)),
  start: Schema.Int.check(Schema.isGreaterThan(0)),
});

export type Range = typeof RangeSchema.Type;

export class CodeRequest extends Schema.Class<CodeRequest>("CodeRequest")({
  body: Schema.String,
  commit: Schema.String,
  configured: Schema.Boolean,
  highlights: Schema.Array(RangeSchema),
  language: Schema.String,
  line: Schema.Int,
  path: Schema.String,
  rangeText: Schema.String,
  ranges: Schema.Array(RangeSchema),
  reference: Schema.Boolean,
  repo: Schema.String,
  sourcePath: Schema.String,
  title: Schema.String,
}) {}

export const codeLineCap = 25;

export const codeIdentity = (
  node: Pick<CodeFence, "lang" | "meta" | "value">
) => JSON.stringify([node.lang ?? "", node.meta ?? "", node.value]);

export const sourceLines = (text: string): readonly string[] => {
  if (text === "") {
    return [];
  }

  const lines = text.replaceAll("\r\n", "\n").split("\n");

  return text.endsWith("\n") ? lines.slice(0, -1) : lines;
};

export const errorContext = (
  request: CodeRequest,
  fix: string,
  actualLength: number | null = null
) => ({
  actualLength,
  commit: request.commit,
  fix,
  line: request.line,
  path: request.path,
  ranges: request.rangeText,
  repo: request.repo,
  sourcePath: request.sourcePath,
});

export const extensions = new Map([
  ["ts", "typescript"],
  ["tsx", "tsx"],
  ["js", "javascript"],
  ["jsx", "jsx"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["json", "json"],
  ["css", "css"],
  ["svelte", "svelte"],
  ["html", "html"],
  ["sql", "sql"],
  ["sh", "bash"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
  ["toml", "toml"],
  ["txt", "text"],
  ["svx", "markdown"],
  ["md", "markdown"],
]);

export const normalizeCodeLanguage = (language: string) => {
  const aliases = new Map([
    ["ts", "typescript"],
    ["js", "javascript"],
    ["sh", "bash"],
    ["shell", "bash"],
    ["yml", "yaml"],
    ["txt", "text"],
    ["svx", "markdown"],
    ["md", "markdown"],
  ]);

  const normalized = language.trim().toLowerCase();

  return (
    aliases.get(normalized) ?? (normalized === "" ? "markdown" : normalized)
  );
};

export type { Token } from "./tokens.ts";

export { TokenSchema, SnippetLine } from "./tokens.ts";
