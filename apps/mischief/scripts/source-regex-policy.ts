import { Schema } from "effect";
import { parse } from "svelte/compiler";

export interface AuditedRegex {
  readonly expression: string;
  readonly reason: string;
}

export const auditedStringRegexes: readonly AuditedRegex[] = [
  {
    expression: "/^h[1-6]$/u",
    reason: "Classify an already-parsed HAST element tag name.",
  },
  {
    expression: "/[.!?](?=\\s|$)/gu",
    reason: "Count sentence endings in a Schema-decoded description scalar.",
  },
  {
    expression: "/^\\d{4}-\\d{2}-\\d{2}$/u",
    reason: "Validate an ISO date scalar after YAML decoding.",
  },
  {
    expression: "/^(?:[@\\w./-]+)(?:\\s[=≠])?[⁰¹²³⁴⁵⁶⁷⁸⁹]*$/u",
    reason:
      "Classify compact peer/version tokens in parsed HAST table-cell text.",
  },
  {
    expression: "/^[a-z0-9]+(?:-[a-z0-9]+)*$/u",
    reason: "Validate the filename-derived slug, not svx content.",
  },
  {
    expression: "/[\\r\\n]/u",
    reason:
      "Reject multiline bibliography scalar fields after Schema decoding.",
  },
  {
    expression: "/https?:\\/\\//u",
    reason: "Reject a URL disguised as a decoded bibliography title.",
  },
  {
    expression: "/\\r?\\n/u",
    reason:
      "Split AGENTS.md table lines at line endings only; no markup matching.",
  },
  {
    // oxlint-disable-next-line eslint/no-template-curly-in-string -- Audited entries preserve literal interpolation syntax in RegExp source.
    expression: "/[.*+?^${}()|[\\]\\\\]/gu",
    reason:
      "Escape a decoded term before constructing its plain-text word matcher.",
  },
  {
    expression:
      // oxlint-disable-next-line eslint/no-template-curly-in-string -- Audited entries preserve literal interpolation syntax in RegExp source.
      'new RegExp(\n    `(?<![\\\\p{L}\\\\p{N}_])(?<term>${terms.map(escapedRegex).join("|")})(?![\\\\p{L}\\\\p{N}_])`,\n    "giu"\n  )',
    reason:
      "Match Schema-decoded, escaped terms in parsed HAST text; never parse svx tags or links.",
  },
  {
    expression: "/(?:^|[.!?]\\s*)$/u",
    reason:
      "Check sentence context in a parsed HAST text node for the ambiguous noun Effect.",
  },
  {
    expression: "/(?:\\.generated|\\.gen)\\.[^.]+$/u",
    reason: "Classify generated filenames for the debt inventory.",
  },
  {
    expression: "/^(?:apps|packages|scripts|tools)\\//u",
    reason: "Classify repository path roots for the debt inventory.",
  },
  {
    expression: "/^[^/]+\\.config\\.ts$/u",
    reason: "Classify root configuration filenames.",
  },
  {
    expression: "/\\.[cm]?[jt]sx?$/u",
    reason: "Classify source-file extensions.",
  },
  {
    expression: "/\\s+/gu",
    reason: "Normalize whitespace in a debt reason scalar.",
  },
  {
    expression: "/\\/$/u",
    reason: "Normalize a URL pathname by removing its trailing slash.",
  },
  {
    expression: "/[{}]/u",
    reason:
      "Detect Svelte braces in already-parsed HAST text, then HTML-escape them.",
  },
  {
    expression:
      "/^(?:\\.brain|\\.pi|\\.cursor|\\.claude|apps|packages|scripts|skills|vendor)\\/[\\w./-]+$|^[\\w.-]+\\.(?:md|ts|js|json|yml|yaml|toml|schema)$/u",
    reason:
      "Classify the value of an mdast inlineCode node as a repository path.",
  },
  {
    expression: "/[^a-z0-9]+/gu",
    reason: "Slug a parsed heading label.",
  },
  {
    expression: "/^-+|-+$/gu",
    reason: "Trim slug separators from a parsed heading label.",
  },
  {
    expression: "/\\.(?:md|svx)$/u",
    reason: "Classify a source filename for a compilation label.",
  },
];

type AstScalar = string | number | boolean | bigint | null | undefined;

interface AstRecord {
  readonly [key: string]: AstValue;
}

type AstValue = AstScalar | AstRecord | readonly AstValue[];

const astValueSchema: Schema.Codec<AstValue> = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.BigInt,
  Schema.Null,
  Schema.Undefined,
  Schema.suspend(() => Schema.Record(Schema.String, astValueSchema)),
  Schema.suspend(() => Schema.Array(astValueSchema)),
]);

const objectSchema = Schema.Record(Schema.String, astValueSchema);

const arraySchema = Schema.Array(astValueSchema);

const nodeSchema = Schema.Struct({
  arguments: Schema.optional(Schema.Array(astValueSchema)),
  callee: Schema.optional(astValueSchema),
  regex: Schema.optional(
    Schema.Struct({ flags: Schema.String, pattern: Schema.String })
  ),
  type: Schema.optional(Schema.String),
});

const identifierSchema = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("Identifier"),
});

const memberSchema = Schema.Struct({
  object: astValueSchema,
  property: astValueSchema,
  type: Schema.Literal("MemberExpression"),
});

const rawSourceNames = new Set([
  "source",
  "rawText",
  "markdown",
  "frontmatter",
  "svx",
  "sourceText",
]);

const isRawSourceIdentifier = (node: AstValue) =>
  Schema.is(identifierSchema)(node) && rawSourceNames.has(node.name);

const positionSchema = Schema.Struct({
  end: Schema.Finite,
  start: Schema.Finite,
});

export const sourceRegexExpressions = (source: string): readonly string[] => {
  const script = `<script lang="ts">${source.replaceAll("</script", "<\\\\/script")}</script>`;
  const tree = parse(script, { modern: true });
  const expressions: string[] = [];

  const visit = (value: AstValue): void => {
    if (Schema.is(arraySchema)(value)) {
      for (const child of value) {
        visit(child);
      }
    } else if (Schema.is(objectSchema)(value)) {
      const node = Schema.decodeUnknownSync(nodeSchema)(value);

      if (
        node.type === "CallExpression" &&
        Schema.is(memberSchema)(node.callee) &&
        Schema.is(identifierSchema)(node.callee.property)
      ) {
        const method = node.callee.property.name;

        const sourceRegexCall =
          ["exec", "test"].includes(method) &&
          (node.arguments?.some(isRawSourceIdentifier) ?? false);

        const sourceReceiver =
          ["match", "matchAll", "search"].includes(method) &&
          isRawSourceIdentifier(node.callee.object);

        if (sourceRegexCall || sourceReceiver) {
          expressions.push("RegExp over svx source is forbidden");
        }
      }

      if (
        node.regex !== undefined ||
        (node.type === "NewExpression" &&
          Schema.is(identifierSchema)(node.callee) &&
          node.callee.name === "RegExp")
      ) {
        const position = Schema.decodeUnknownSync(positionSchema)(value);
        expressions.push(script.slice(position.start, position.end));
      }

      for (const child of Object.values(value)) {
        visit(child);
      }
    }
  };

  visit(Schema.decodeUnknownSync(astValueSchema)(tree.instance?.content));

  return expressions;
};

export const sourceRegexViolations = (
  source: string,
  fileName: string
): readonly string[] =>
  sourceRegexExpressions(source)
    .filter(
      (expression) =>
        !auditedStringRegexes.some(
          (entry) => entry.expression === expression && entry.reason !== ""
        )
    )
    .map((expression) => `${fileName}: unaudited RegExp ${expression}`);
