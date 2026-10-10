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
