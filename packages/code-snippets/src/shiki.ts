import { Context, Effect, Layer, Predicate, Schema } from "effect";
import type { BundledLanguage, BundledTheme, ShikiTransformer } from "shiki";
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

const latteColors = {
  "#04a5e5": "#03709c",
  "#179299": "#12747a",
  "#1e66f5": "#0f5bf4",
  "#40a02b": "#307820",
  "#7c7f93": "#66687b",
  "#8839ef": "#8737ef",
  "#d20f39": "#d00f39",
  "#df8e1d": "#935d13",
  "#e64553": "#ce1c2b",
  "#ea76cb": "#bf1d94",
  "#fe640b": "#b74301",
};

const mochaColors = {
  "#9399b2": "#949ab3",
};

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

const lightFontStyles: ShikiTransformer = {
  name: "rat-light-font-styles",
  tokens: (lines) =>
    lines.map((line) =>
      line.map((token) => ({
        ...token,
        htmlStyle: Object.fromEntries(
          Object.entries(token.htmlStyle ?? {}).flatMap(([key, value]) => {
            if (key.startsWith("--shiki-light-")) {
              return value === "inherit"
                ? []
                : [[key.slice("--shiki-light-".length), value]];
            }

            return key.startsWith("--shiki-dark-") && key !== "--shiki-dark-bg"
              ? []
              : [[key, value]];
          })
        ),
      }))
    ),
};

export const shikiLayer = (
  theme: BundledTheme = "catppuccin-latte",
  darkTheme: BundledTheme = "catppuccin-mocha"
) =>
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
            themes: [theme, darkTheme],
          }),
        }),
        (resource) =>
          Effect.sync(() => {
            resource.dispose();
          })
      );

      const lightColors =
        theme === "catppuccin-latte" && darkTheme !== theme ? latteColors : {};

      const darkColors =
        darkTheme === "catppuccin-mocha" && theme !== darkTheme
          ? mochaColors
          : {};

      const themeOptions = {
        colorReplacements: { [theme]: lightColors, [darkTheme]: darkColors },
        themes: { dark: darkTheme, light: theme },
      };

      const originalLightColors = new Map(
        Object.entries(lightColors).map(([original, replacement]) => [
          replacement,
          original,
        ])
      );

      const fingerprint = `shiki@4.6.0:${theme}:${darkTheme}:${JSON.stringify([lightColors, darkColors])}`;
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
        ).pipe(
          Effect.mapError(
            (cause) => new HighlightFault({ cause, kind: "language" })
          )
        );

        const contentKey = JSON.stringify([
          key,
          source,
          canonical,
          fingerprint,
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
              .codeToTokensWithThemes(source, {
                ...themeOptions,
                lang: canonical,
              })
              .map((line) =>
                line.map((token) => {
                  const color = token.variants.light?.color;

                  return {
                    color,
                    darkColor: token.variants.dark?.color,
                    fontStyle: token.variants.light?.fontStyle ?? 0,
                    role: roleFor(
                      originalLightColors.get(color?.toLowerCase() ?? "") ??
                        color
                    ),
                    text: token.content,
                  };
                })
              ),
        });

        cache.set(contentKey, result);

        return result;
      });

      const port = Highlighter.of({
        aliases: () => aliases,
        fingerprint,
        languages: () => [...Object.keys(bundledLanguages), "text"],
        themes: () => [theme, darkTheme],
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
          ...themeOptions,
          defaultColor: "light",
          lang: canonical,
          transformers: [lightFontStyles],
        });
      };

      return Context.add(
        Context.make(Highlighter, port),
        FenceHighlighter,
        FenceHighlighter.of({ render })
      );
    })
  );
