// @effect-diagnostics nodeBuiltinImport:off -- These tests build the app with the real Vite binary and read the emitted source maps from disk.
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import {
  globSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { Clock, DateTime, Duration, Effect, Schema } from "effect";

import { declarativeToolNames } from "../../site/scripts/web-mcp-forms.js";
import { ContentAssetManifest } from "../../site/src/asset-manifest.js";
import { webMcpContracts } from "../src/client/web-mcp-contracts.js";
import { ReaderSource } from "../src/reader-cafe.js";
import { readerCodeWithoutPageData } from "./reader-bundle-data.js";

const webRoot = path.resolve(import.meta.dirname, "..");

const vite = path.join(webRoot, "node_modules/.bin/vite");

const decodeSourceMap = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ sources: Schema.Array(Schema.String) }))
);

const decodeReaderPages = Schema.decodeSync(
  Schema.fromJsonString(Schema.Array(ReaderSource))
);

const chromeTrialScriptPath = "/assets/webmcp-origin-trial.js";

const chromeTrialScriptTag = `<script src="${chromeTrialScriptPath}">`;

const ChromeTrialPayload = Schema.Struct({
  expiry: Schema.Int,
  feature: Schema.Literal("WebMCP"),
  isSubdomain: Schema.Literal(true),
  isThirdParty: Schema.Literal(true),
  origin: Schema.Literal("https://ratstack.sh:443"),
});

const checkChromeTrialAsset = (outDir: string) => {
  const script = readFileSync(
    path.join(outDir, chromeTrialScriptPath.slice(1)),
    "utf-8"
  );

  const token = Schema.decodeUnknownSync(Schema.NonEmptyString)(
    /\bmeta\.content\s*=\s*"(?<token>[A-Za-z0-9+/]+={0,2})"/u.exec(script)
      ?.groups?.token
  );

  const bytes = Buffer.from(token, "base64");
  const payloadLengthOffset = 1 + 64;
  const payloadOffset = payloadLengthOffset + 4;

  expect(bytes[0]).toBe(3);
  expect(bytes.readUInt32BE(payloadLengthOffset)).toBe(
    bytes.length - payloadOffset
  );

  return Schema.decodeSync(Schema.fromJsonString(ChromeTrialPayload))(
    bytes.toString("utf-8", payloadOffset)
  );
};

const checkChromeTrialHead = (html: string, file: string) => {
  const scripts = [...html.matchAll(/<script\b[^>]*>/gu)];

  const trialScripts = scripts.filter(([tag]) =>
    tag.includes(chromeTrialScriptPath)
  );

  const offset = trialScripts[0]?.index ?? -1;
  const firstModule = scripts.find(([tag]) => tag.includes('type="module"'));

  expect(
    trialScripts.map(([tag]) => tag),
    file
  ).toEqual([chromeTrialScriptTag]);
  expect(offset, file).toBeGreaterThan(html.indexOf("<head>"));
  expect(offset, file).toBeLessThan(html.indexOf("</head>"));
  expect(firstModule?.index ?? -1, file).toBeGreaterThan(offset);
};

const forbiddenStrings = [
  "rat_call",
  "rat_test_person",
  "rat-test-person-password",
];

const forbiddenModules = [
  "src/dev/",
  "../../packages/devtools/",
  "../../packages/auth/src/devtools",
  "@foldkit/markdown",
  "@foldkit+markdown@",
  "htmlparser2",
  "code-snippets",
  "shiki",
  "../../packages/og/",
  "@rat-stack/og/",
  "satori/",
  "satori@",
  "@resvg/",
  "@resvg+resvg-js@",
  "../site/scripts/og-route-gate",
  "../site/scripts/reader-body-document",
  "../site/scripts/reader-site-inputs",
];

const cafeModules = (sources: readonly string[]) =>
  sources.filter((source) =>
    /(?:^|\/)src\/(?:reader-cafe\.ts$|client\/(?:(?:all-stars|directory|news)-effect-ui\/|effect-ui-handoff\.ts$))/u.test(
      source
    )
  );

const staticModules = (outDir: string, html: string) =>
  [
    ...html.matchAll(
      /<(?:script type="module" crossorigin src|link rel="modulepreload" crossorigin href)="\/(?<file>[^"]+\.js)"/gu
    ),
  ].flatMap(([, file]) =>
    decodeSourceMap(
      readFileSync(path.join(outDir, `${file}.map`), "utf-8")
    ).sources.map((source) =>
      source.split(path.sep).join("/").replace(/\?.*$/u, "")
    )
  );

const checkCafeBoundary = (outDir: string) => {
  const modules = (file: string) =>
    staticModules(outDir, readFileSync(path.join(outDir, file), "utf-8"));

  const home = modules("index.html");

  expect(home.some((id) => id.endsWith("/client/reader/model.ts"))).toBe(true);
  expect(cafeModules(home), "Home preloads Cafe module IDs").toEqual([]);

  for (const route of ["all-stars", "directory", "news"]) {
    expect(
      modules(`${route}/index.html`).some((id) =>
        id.endsWith(`/client/${route}-effect-ui/model.ts`)
      ),
      route
    ).toBe(true);
  }
};

const build = (nodeEnv: "development" | "production") => {
  const outDir = mkdtempSync(path.join(tmpdir(), "rat-web-bundle-"));

  try {
    symlinkSync(
      path.join(webRoot, "node_modules"),
      path.join(outDir, "node_modules"),
      "dir"
    );

    const result = spawnSync(
      vite,
      ["build", "--sourcemap", "--outDir", outDir, "--logLevel", "error"],
      {
        cwd: webRoot,
        encoding: "utf-8",
        env: { ...process.env, NODE_ENV: nodeEnv },
      }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(path.join(outDir, "index.html"), "utf-8")).toMatch(
      /<h1(?: [^>]*)?>Rat Stack<\/h1>/u
    );

    const allowedToolNames = new Set<string>(
      webMcpContracts.map(({ name }) => name)
    );

    if (nodeEnv === "production") {
      checkCafeBoundary(outDir);
    }

    const chromeTrial =
      nodeEnv === "production" ? checkChromeTrialAsset(outDir) : undefined;

    for (const file of globSync("**/*.html", { cwd: outDir })) {
      const html = readFileSync(path.join(outDir, file), "utf-8");

      if (nodeEnv === "production") {
        checkChromeTrialHead(html, file);
      }

      const undeclared = declarativeToolNames(html).filter(
        (name) => !allowedToolNames.has(name)
      );

      expect(
        undeclared,
        `${file} declares a WebMCP form without a public contract. Fix: use a name from \`webMcpContracts\`.`
      ).toEqual([]);
    }

    const contentRoot = path.resolve(webRoot, "../site/dist/content");

    const manifest = Schema.decodeSync(
      Schema.fromJsonString(ContentAssetManifest)
    )(readFileSync(path.join(contentRoot, "manifest.json"), "utf-8"));

    const preparedPages = decodeReaderPages(
      readFileSync(path.join(webRoot, "dist/reader-pages.json"), "utf-8")
    );

    for (const image of manifest.images.filter((asset) =>
      preparedPages.some(
        (page) =>
          new URL(page.page.metadata.ogImagePath, page.origin).pathname ===
            asset ||
          (page.page.path !== "/" && asset.startsWith(`${page.page.path}/`))
      )
    )) {
      expect(readFileSync(path.join(outDir, image.slice(1))), image).toEqual(
        readFileSync(
          path.join(contentRoot, "assets", manifest.generation, image.slice(1))
        )
      );
    }

    const maps = globSync("**/*.map", { cwd: outDir });

    const sources = maps.flatMap((file) =>
      decodeSourceMap(
        readFileSync(path.join(outDir, file), "utf-8")
      ).sources.map((source) =>
        path
          .relative(webRoot, path.resolve(outDir, path.dirname(file), source))
          .split(path.sep)
          .join("/")
          .replace(/\?.*$/u, "")
      )
    );

    const emitted = globSync("**/*.js", { cwd: outDir }).map((file) => {
      const code = readFileSync(path.join(outDir, file), "utf-8");

      return {
        full: code,
        runtime: readerCodeWithoutPageData(code, preparedPages),
      };
    });

    return {
      chromeTrial,
      sources: new Set(sources),
      strings: forbiddenStrings.filter((text) =>
        emitted.some((code) =>
          (text === "rat-test-person-password"
            ? code.full
            : code.runtime
          ).includes(text)
        )
      ),
    };
  } finally {
    rmSync(outDir, { force: true, recursive: true });
  }
};

const devtoolsModules = (sources: ReadonlySet<string>) =>
  [...sources].filter((source) =>
    forbiddenModules.some((prefix) => source.includes(prefix))
  );

const BUILD = 180_000;

describe("production bundle", () => {
  it.live(
    "statically renders home and excludes server devtools from browser and Worker output",
    () =>
      Effect.gen(function* checkProductionBuild() {
        const { chromeTrial, sources, strings } = yield* Effect.sync(() =>
          build("production")
        );

        expect(sources.has("src/entry.server.ts")).toBe(true);
        expect(devtoolsModules(sources)).toEqual([]);
        expect(strings).toEqual([]);

        if (chromeTrial !== undefined) {
          const expiresAt = Duration.toMillis(
            Duration.seconds(chromeTrial.expiry)
          );

          const now = yield* Clock.currentTimeMillis;

          if (expiresAt - now <= Duration.toMillis(Duration.days(45))) {
            yield* Effect.logWarning(
              `Chrome WebMCP origin-trial expiry: ${DateTime.formatIso(DateTime.makeUnsafe(expiresAt))}. Renew the token in apps/web/public${chromeTrialScriptPath}.`
            );
          }
        }
      }),
    BUILD
  );

  it(
    "would contain them in a development build, so the checks can fail",
    () => {
      const { sources, strings } = build("development");

      expect(sources.has("src/entry.server.ts")).toBe(true);
      expect(sources.has("src/dev/features/overlay/overlay.ts")).toBe(true);
      expect(
        [...sources].some((source) =>
          source.startsWith("../../packages/devtools/")
        )
      ).toBe(true);
      expect(strings).toEqual(["rat_call", "rat_test_person"]);
    },
    BUILD
  );
});
