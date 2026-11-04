import { Context, Effect, Layer, Predicate, Schema } from "effect";
import type { BundledLanguage } from "shiki";
import {
  bundledLanguages,
  bundledLanguagesInfo,
  createCssVariablesTheme,
  createHighlighter,
} from "shiki";

import { normalizeCodeLanguage } from "./model.ts";
import type { Token } from "./model.ts";
import { HighlightFault, Highlighter } from "./ports.ts";

const Language = Schema.declare<BundledLanguage | "text">(
  (value): value is BundledLanguage | "text" =>
    Predicate.isString(value) &&
    (value === "text" || Object.hasOwn(bundledLanguages, value))
);

const roleFor = (color: string | undefined): Token["role"] => {
  if (
    color === "var(--shiki-token-comment)" ||
    color === "var(--shiki-token-punctuation)"
  ) {
    return "muted";
  }

  if (color === "var(--shiki-token-keyword)") {
    return "keyword";
  }

  if (
    color === "var(--shiki-token-string)" ||
    color === "var(--shiki-token-string-expression)" ||
    color === "var(--shiki-token-constant)"
  ) {
    return "literal";
  }

  return "ink";
};

export class FenceHighlighter extends Context.Service<
  FenceHighlighter,
  {
    readonly render: (
      source: string,
      language: string | null | undefined
    ) => string;
  }
>()("code-snippets/ShikiFenceHighlighter") {}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const shikiTheme = createCssVariablesTheme({
  name: "rat-css-variables",
  variablePrefix: "--shiki-",
});

export const shikiLayer = () =>
  Layer.effectContext(
    Effect.gen(function* makeShiki() {
      const engine = yield* Effect.acquireRelease(
        Effect.tryPromise({
          catch: () => new HighlightFault({ kind: "render" }),
          try: createHighlighter.bind(undefined, {
            langs: [
              "bash",
              "css",
              "html",
              "javascript",
              "json",
              "svelte",
              "sql",
              "toml",
              "typescript",
              "yaml",
              "markdown",
              "http",
            ],
            themes: [shikiTheme],
          }),
        }),
        (resource) =>
          Effect.sync(() => {
            resource.dispose();
          })
      );

      const cache = new Map<string, readonly (readonly Token[])[]>();

      const aliases = Object.fromEntries(
        bundledLanguagesInfo.flatMap((info) =>
          (info.aliases ?? []).map((alias) => [alias, info.id])
        )
      );

      const tokens = Effect.fn("Shiki.tokens")(function* tokens(
        source: string,
        language: string,
        key: string
      ) {
        const canonical = yield* Schema.decodeUnknownEffect(Language)(
          aliases[language] ?? language
        ).pipe(Effect.mapError(() => new HighlightFault({ kind: "language" })));

        const contentKey = JSON.stringify([
          key,
          source,
          canonical,
          shikiTheme.name,
          "shiki@4.5.0",
        ]);

        const cached = cache.get(contentKey);

        if (cached !== undefined) {
          return cached;
        }

        if (
          canonical !== "text" &&
          !engine.getLoadedLanguages().includes(canonical)
        ) {
          yield* Effect.tryPromise({
            catch: () => new HighlightFault({ kind: "render" }),
            try: () => engine.loadLanguage(canonical),
          });
        }

        const result = yield* Effect.try({
          catch: () => new HighlightFault({ kind: "render" }),
          try: () =>
            engine
              .codeToTokensBase(source, { lang: canonical, theme: shikiTheme })
              .map((line) =>
                line.map(({ color, content, fontStyle }) => ({
                  color,
                  fontStyle: fontStyle ?? 0,
                  role: roleFor(color),
                  text: content,
                }))
              ),
        });

        cache.set(contentKey, result);

        return result;
      });

      const port = Highlighter.of({
        aliases: () => aliases,
        fingerprint: `shiki@4.5.0:${shikiTheme.name}`,
        languages: () => [...Object.keys(bundledLanguages), "text"],
        themes: () => [shikiTheme.name ?? "rat-css-variables"],
        tokens,
      });

      const render = (source: string, language: string | null | undefined) => {
        const normalized = normalizeCodeLanguage(language ?? "");

        const canonical = Schema.decodeUnknownSync(Language)(
          aliases[normalized] ?? normalized
        );

        if (canonical === "text") {
          return `<pre><code>${escapeHtml(source)}</code></pre>`;
        }

        return engine.codeToHtml(source, {
          lang: canonical,
          theme: shikiTheme,
        });
      };

      return Context.add(
        Context.make(Highlighter, port),
        FenceHighlighter,
        FenceHighlighter.of({ render })
      );
    })
  );
