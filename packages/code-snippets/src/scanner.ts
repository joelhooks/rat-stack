import { Effect, Schema } from "effect";

import {
  CodeBodyWithReference,
  CodeDuplicateKey,
  CodeInvalidProps,
  CodeInvalidRanges,
  CodeMalformedMeta,
  CodeUnknownKey,
} from "./errors.ts";
import {
  CodeRequest,
  RangeSchema,
  extensions,
  normalizeCodeLanguage,
} from "./model.ts";
import type { CodeFence, Range } from "./model.ts";

type ErrorContext = Omit<
  ConstructorParameters<typeof CodeInvalidProps>[0],
  "_tag"
>;

type ContextFor = (fix: string) => ErrorContext;

const whitespace = (char: string) =>
  char === " " || char === "\t" || char === "\n" || char === "\r";

const digits = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charAt(index);

    if (char < "0" || char > "9") {
      return false;
    }
  }

  return value !== "";
};

const allowedKeys = new Set(["repo", "path", "at", "lines", "title"]);

const quotedString = Schema.fromJsonString(Schema.String);

const scanValue = Effect.fn("scanValue")(function* scanValue(
  meta: string,
  start: number,
  key: string,
  context: ContextFor
) {
  let end = start;

  if (meta.charAt(start) !== '"') {
    while (end < meta.length && !whitespace(meta.charAt(end))) {
      end += 1;
    }

    return { end, value: meta.slice(start, end) };
  }

  end += 1;
  let escaped = false;

  while (end < meta.length) {
    const char = meta.charAt(end);

    if (!escaped && char === '"') {
      const value = yield* Schema.decodeEffect(quotedString)(
        meta.slice(start, end + 1)
      ).pipe(
        Effect.mapError(
          () =>
            new CodeMalformedMeta(context(`Use a valid quoted ${key} string.`))
        )
      );

      return { end: end + 1, value };
    }

    escaped = !escaped && char === "\\";
    end += 1;
  }

  return yield* new CodeMalformedMeta(
    context(`Close the quoted ${key} value.`)
  );
});

const scanPair = Effect.fn("scanPair")(function* scanPair(
  meta: string,
  start: number,
  fields: Readonly<Record<string, string>>,
  context: ContextFor
) {
  let cursor = start;

  while (
    cursor < meta.length &&
    !whitespace(meta.charAt(cursor)) &&
    meta.charAt(cursor) !== "="
  ) {
    cursor += 1;
  }

  const key = meta.slice(start, cursor);

  if (meta.charAt(cursor) !== "=") {
    return yield* new CodeMalformedMeta(
      context('Write metadata as key=value or key="quoted value".')
    );
  }

  if (!allowedKeys.has(key)) {
    return yield* new CodeUnknownKey(
      context(`Unknown key ${key}; use repo, path, at, lines or title.`)
    );
  }

  if (Object.hasOwn(fields, key)) {
    return yield* new CodeDuplicateKey(context(`Remove duplicate ${key}.`));
  }

  const { end, value } = yield* scanValue(meta, cursor + 1, key, context);

  if (value === "" || (end < meta.length && !whitespace(meta.charAt(end)))) {
    return yield* new CodeMalformedMeta(
      context(
        `Give ${key} a value and separate metadata items with whitespace.`
      )
    );
  }

  return { end, key, value };
});

const parseRanges = Effect.fn("parseRanges")(function* parseRanges(
  value: string,
  label: string,
  context: ContextFor
): Effect.fn.Return<readonly Range[], CodeInvalidRanges> {
  if (value === "") {
    return [];
  }

  const ranges: Range[] = [];

  for (const part of value.split(",")) {
    const pair = part.split("-");
    const start = Number(pair[0]);
    const end = Number(pair[1] ?? pair[0]);

    const parsed = yield* Schema.decodeEffect(RangeSchema)({ end, start }).pipe(
      Effect.mapError(
        () =>
          new CodeInvalidRanges(
            context(
              `Use positive line numbers or ranges for ${label}, such as 3,5-7.`
            )
          )
      )
    );

    if (
      pair.length > 2 ||
      !pair.every(digits) ||
      end < start ||
      (ranges.at(-1)?.end ?? 0) >= start
    ) {
      return yield* new CodeInvalidRanges(
        context(`Order ${label} without overlaps, such as 3,5-7.`)
      );
    }

    ranges.push(parsed);
  }

  return ranges;
});

const validCommit = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charAt(index);

    if (!(char >= "0" && char <= "9") && !(char >= "a" && char <= "f")) {
      return false;
    }
  }

  return value.length === 40;
};

const validPath = (value: string) =>
  !value.startsWith("/") &&
  !value.includes(":") &&
  !value
    .split("/")
    .some((part) => part === ".." || part === "" || part === ".");

const validateReference = Effect.fn("validateReference")(
  function* validateReference(
    fields: Readonly<Record<string, string>>,
    body: string,
    context: ContextFor
  ) {
    if (fields.path === undefined) {
      if (["repo", "at", "lines"].some((key) => fields[key] !== undefined)) {
        return yield* new CodeInvalidProps(
          context("Add path for a pinned reference, or remove repo/at/lines.")
        );
      }

      return false;
    }

    if (body.trim() !== "") {
      return yield* new CodeBodyWithReference(
        context(
          "Remove the fence body; path references read their content from Git."
        )
      );
    }

    if (!validCommit(fields.at ?? "")) {
      return yield* new CodeInvalidProps(
        context("Pin at to a full 40-character lowercase commit SHA.")
      );
    }

    if (!validPath(fields.path)) {
      return yield* new CodeInvalidProps(
        context(
          "Use a repository-relative file path without traversal or colons."
        )
      );
    }

    return true;
  }
);

const scannedRequest = Effect.fn("scannedRequest")(function* scannedRequest(
  node: CodeFence,
  sourcePath: string,
  fields: Readonly<Record<string, string>>,
  highlightText: string | undefined,
  configured: boolean,
  language: string,
  context: ContextFor
) {
  const reference = yield* validateReference(fields, node.value, context);
  const ranges = yield* parseRanges(fields.lines ?? "", "lines", context);

  if (reference && ranges.length === 0) {
    return yield* new CodeInvalidRanges(
      context("Set lines to the excerpt, such as lines=3-7.")
    );
  }

  if (highlightText === "") {
    return yield* new CodeMalformedMeta(
      context("Put line numbers inside the highlight set, such as {3,5-7}.")
    );
  }

  const highlights = yield* parseRanges(
    highlightText ?? "",
    "highlights",
    context
  ).pipe(Effect.mapError((error) => new CodeMalformedMeta(context(error.fix))));

  const selectedLanguage =
    language === ""
      ? (extensions.get(fields.path?.split(".").at(-1) ?? "") ?? "markdown")
      : normalizeCodeLanguage(language);

  return yield* Schema.decodeEffect(CodeRequest)({
    body: node.value,
    commit: fields.at ?? "<inline>",
    configured,
    highlights,
    language: selectedLanguage,
    line: node.line,
    path: fields.path ?? "<inline>",
    rangeText: fields.lines ?? "all",
    ranges,
    reference,
    repo: fields.repo ?? "rat-stack",
    sourcePath,
    title: fields.title ?? fields.path?.split("/").at(-1) ?? "Code",
  }).pipe(
    Effect.mapError(
      () =>
        new CodeInvalidProps(
          context("Use the documented fence metadata grammar.")
        )
    )
  );
});

export const parseCodeRequest = Effect.fn("parseCodeRequest")(
  function* parseCodeRequest(node: CodeFence, sourcePath: string) {
    const rawLanguage = node.lang ?? "";

    const hasLanguage =
      rawLanguage !== "" &&
      !rawLanguage.includes("=") &&
      !rawLanguage.startsWith("{");

    const meta = [hasLanguage ? "" : rawLanguage, node.meta ?? ""]
      .filter((part) => part !== "")
      .join(" ");

    const fields: Record<string, string> = {};
    let highlightText: string | undefined;
    let cursor = 0;

    const context: ContextFor = (fix) => ({
      actualLength: null,
      commit: fields.at ?? "<inline>",
      fix,
      line: node.line,
      path: fields.path ?? "<inline>",
      ranges: fields.lines ?? "all",
      repo: fields.repo ?? "rat-stack",
      sourcePath,
    });

    while (cursor < meta.length) {
      if (whitespace(meta.charAt(cursor))) {
        cursor += 1;
        continue;
      }

      if (meta.charAt(cursor) === "{") {
        if (highlightText !== undefined) {
          return yield* new CodeDuplicateKey(
            context("Use one {line,ranges} highlight set.")
          );
        }

        const end = meta.indexOf("}", cursor + 1);

        if (end === -1) {
          return yield* new CodeMalformedMeta(
            context("Close the highlight set with }.")
          );
        }

        highlightText = meta.slice(cursor + 1, end);
        cursor = end + 1;

        if (cursor < meta.length && !whitespace(meta.charAt(cursor))) {
          return yield* new CodeMalformedMeta(
            context("Separate metadata items with whitespace.")
          );
        }
      } else {
        const item = yield* scanPair(meta, cursor, fields, context);
        fields[item.key] = item.value;
        cursor = item.end;
      }
    }

    return yield* scannedRequest(
      node,
      sourcePath,
      fields,
      highlightText,
      meta !== "",
      hasLanguage ? rawLanguage : "",
      context
    );
  }
);

export const printCodeRequest = (request: CodeRequest): CodeFence => {
  const fields = request.reference
    ? `repo=${request.repo} path=${JSON.stringify(request.path)} at=${request.commit} lines=${request.rangeText} `
    : "";

  const highlights =
    request.highlights.length === 0
      ? ""
      : `{${request.highlights.map((range) => (range.start === range.end ? String(range.start) : `${range.start}-${range.end}`)).join(",")}} `;

  return {
    lang: request.language,
    line: request.line,
    meta: request.configured
      ? `${fields}${highlights}title=${JSON.stringify(request.title)}`
      : null,
    value: request.body,
  };
};
