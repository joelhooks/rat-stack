import { Context, Effect, Layer, Predicate, Schema } from "effect";
import type { BundledLanguage } from "shiki";
import {
  bundledLanguages,
  bundledLanguagesInfo,
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

const roleFor = (rawColor: string | undefined): Token["role"] => {
  const color = rawColor?.toLowerCase();

  if (color === "#9ca0b0" || color === "#7c7f93") {
    return "muted";
  }

  if (color === "#8839ef" || color === "#d20f39" || color === "#ea76cb") {
    return "keyword";
  }

  if (color === "#40a02b" || color === "#df8e1d") {
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

export const shikiLayer = (theme = "catppuccin-latte") =>
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
            themes: [theme],
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
          theme,
          "shiki@3.23.0",
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
            // @effect-diagnostics-next-line asyncFunction:off -- Shiki owns the variadic Promise grammar-loader boundary.
            try: async () => {
              await engine.loadLanguage(canonical);
            },
          });
        }

        const result = yield* Effect.try({
          catch: () => new HighlightFault({ kind: "render" }),
          try: () =>
            engine
              .codeToTokens(source, { lang: canonical, theme })
              .tokens.map((line) =>
                line.map((token) => ({
                  fontStyle: token.fontStyle ?? 0,
                  role: roleFor(token.color),
                  text: token.content,
                }))
              ),
        });

        cache.set(contentKey, result);

        return result;
      });

      const port = Highlighter.of({
        aliases: () => aliases,
        fingerprint: `shiki@3.23.0:${theme}`,
        languages: () => [...Object.keys(bundledLanguages), "text"],
        themes: () => [theme],
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

        return engine.codeToHtml(source, { lang: canonical, theme });
      };

      return Context.add(
        Context.make(Highlighter, port),
        FenceHighlighter,
        FenceHighlighter.of({ render })
      );
    })
  );
