import { NodeServices } from "@effect/platform-node";
import { HtmlCommand, HtmlServer } from "@effect/ui/html";
import { HtmlLocator, HtmlScene, ssr } from "@effect/ui/html/testing";
import { Story, TestHost } from "@effect/ui/testing";
import { expect, it } from "@effect/vitest";
import {
  CafeLetter,
  cafeLetters,
  filterCafeProjects,
} from "@rat-stack/core/contracts";
import { Effect, FileSystem, Logger, Option, Path, Schema } from "effect";

import { DirectoryPage } from "../src/client/directory-effect-ui/component.js";
import { hydrateDirectory } from "../src/client/directory-effect-ui/hydration.js";
import {
  DirectoryHandoff,
  DirectoryMessage,
  directoryHandoffId,
  directoryRootId,
} from "../src/client/directory-effect-ui/model.js";
import {
  directoryCopy,
  letterNames,
  projectCount,
} from "../src/features/cafe/copy.js";
import { CafePage, ReaderSource } from "../src/reader-cafe.js";
import { renderDirectoryPage } from "../src/server/directory-effect-ui.js";
import {
  renderDocument,
  withReaderHead,
} from "../src/server/reader-document.js";
import { ReaderErrorTemplate } from "../src/server/reader-error-template.js";
import {
  renderDirectoryOrError,
  renderReaderError,
} from "../src/server/reader-render.js";
import { cafeProject, directoryHome } from "./cafe-fixture.js";
import { cafeParity } from "./cafe-parity.js";
import legacyDirectory from "./fixtures/foldkit-directory-parity.json";

const directoryFlags = Effect.gen(function* directoryFlags() {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;

  const source = yield* fs.readFileString(
    paths.resolve(import.meta.dirname, "../dist/reader-pages.json")
  );

  const pages = yield* Schema.decodeEffect(
    Schema.fromJsonString(Schema.Array(ReaderSource))
  )(source);

  const flags = yield* Effect.fromOption(
    Option.fromNullishOr(pages.find((page) => page.page.path === "/directory"))
  );

  const cafe = yield* Effect.fromOption(
    flags.cafe.pipe(Option.filter(CafePage.guards.Directory))
  );

  return { cafe, flags };
});

const parseMarkup = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");

const projectLinks = (root: ParentNode) =>
  [...root.querySelectorAll("li > article > p:first-child > a")].map((link) =>
    link.getAttribute("href")
  );

const assets = {
  entryScript: "/assets/directory-effect-ui-test.js",
  modulePreloads: [],
  stylesheets: [],
};

it.effect("the story toggles each letter independently and clears them", () =>
  Effect.gen(function* directoryStory() {
    const story = yield* Story.make(DirectoryPage, {
      projects: [],
      selected: [],
    });

    expect(
      story.send(DirectoryMessage.ToggledStackLetter({ letter: "alchemy" }))
        .model
    ).toEqual(["alchemy"]);
    expect(
      story.send(DirectoryMessage.ToggledStackLetter({ letter: "effect" }))
        .model
    ).toEqual(["alchemy", "effect"]);
    expect(
      story.send(DirectoryMessage.ToggledStackLetter({ letter: "alchemy" }))
        .model
    ).toEqual(["effect"]);
    expect(story.send(DirectoryMessage.ClearedStackLetters()).model).toEqual(
      []
    );
    story.resolve(HtmlCommand.Focus, { found: true });
  })
);

it.effect(
  "the scene narrows and clears the keyed project list through the letter buttons",
  () =>
    Effect.gen(function* directoryScene() {
      const cafe = directoryHome;
      const letter = "alchemy";

      const matching = filterCafeProjects(cafe.projects, [letter]);

      expect(matching.length).toBeGreaterThan(0);
      expect(matching.length).toBeLessThan(cafe.projects.length);

      const scene = yield* HtmlScene.make(DirectoryPage, cafe);
      const toggle = HtmlLocator.role("button", { name: letterNames[letter] });
      const status = HtmlLocator.role("status");

      const clear = HtmlLocator.role("button", {
        name: directoryCopy.clearLabel,
      });

      scene.expect(status).toHaveText(projectCount(cafe.projects.length));
      scene.expect(toggle).toHaveAttribute("aria-pressed", "false");
      scene.click(toggle);
      scene.expect(status).toHaveText(projectCount(matching.length));
      scene.expect(toggle).toHaveAttribute("aria-pressed", "true");
      scene.click(clear).resolve(HtmlCommand.Focus, { found: true });
      scene.expect(status).toHaveText(projectCount(cafe.projects.length));
      scene.expect(toggle).toHaveAttribute("aria-pressed", "false");
      scene.expect(clear).toBeAbsent();
    })
);

const stackEvidence = Schema.NullOr(Schema.Literals(["", "in package.json"]));

const generatedStack = Schema.Struct({
  alchemy: stackEvidence,
  cloudflare: stackEvidence,
  effect: stackEvidence,
  foldkit: stackEvidence,
});

it.effect.prop(
  "the rendered directory shows the matching generated projects in order",
  { selected: Schema.Array(CafeLetter), stacks: Schema.Array(generatedStack) },
  ({ selected, stacks }) =>
    Effect.gen(function* directoryFilter() {
      const projects = stacks.map((stack, index) => ({
        ...cafeProject(`probe-${index}`, []),
        stack,
      }));

      const filtered = yield* HtmlServer.renderToHtml(DirectoryPage, {
        projects,
        selected,
      });

      const expected = projects.flatMap(({ stack, url }) =>
        selected.some((letter) => stack[letter] === null) ? [] : [url]
      );

      expect(projectLinks(parseMarkup(filtered.html))).toEqual(expected);
    }),
  { arbitrary: { runs: 40 } }
);

it.live("directory text and styles match the captured Foldkit fixtures", () =>
  Effect.gen(function* directoryParity() {
    const { flags } = yield* directoryFlags;

    const cases = [
      { expected: legacyDirectory.all, selected: [] },
      {
        expected: legacyDirectory.alchemy,
        selected: [CafeLetter.make("alchemy")],
      },
    ];

    for (const { expected, selected } of cases) {
      const props = { ...directoryHome, selected };
      const rendered = yield* renderDirectoryPage(flags, props, assets);

      const html = renderDocument(withReaderHead(rendered, flags), assets);

      expect(cafeParity(parseMarkup(html), "main li:has(>article)")).toEqual(
        expected
      );
    }
  }).pipe(Effect.provide(NodeServices.layer))
);

it.live(
  "the built Directory preserves the catalog order and explicit handoff",
  () =>
    Effect.gen(function* committedDirectory() {
      const { cafe } = yield* directoryFlags;
      const fs = yield* FileSystem.FileSystem;
      const paths = yield* Path.Path;

      const output = parseMarkup(
        yield* fs.readFileString(
          paths.resolve(
            import.meta.dirname,
            "../dist/client/directory/index.html"
          )
        )
      );

      const urls = cafe.projects.map(({ url }) => url);

      expect(new Set(urls).size).toBe(urls.length);
      expect(projectLinks(output)).toEqual(urls);
      expect(
        output.querySelector("[data-foldkit-app], [data-foldkit-flags]")
      ).toBeNull();

      const payload = output.querySelector(`#${directoryHandoffId}`);
      expect(payload?.getAttribute("type")).toBe("application/json");

      const { props, state } = yield* Schema.decodeEffect(
        Schema.fromJsonString(DirectoryHandoff)
      )(payload?.textContent ?? "");

      expect(props).toEqual({ projects: cafe.projects, selected: [] });
      expect(state["/DirectoryPage"]).toEqual([]);
      expect(output.querySelector(`#${directoryRootId}`)).not.toBeNull();
    }).pipe(Effect.provide(NodeServices.layer))
);

const unavailableDirectory = () =>
  Promise.reject(new Error("unavailable directory chunk"));

it.live(
  "missing Directory data, a failed import and a view defect render the site 500",
  () =>
    Effect.gen(function* directoryError() {
      const { flags } = yield* directoryFlags;
      const fs = yield* FileSystem.FileSystem;
      const paths = yield* Path.Path;

      const template = yield* Schema.decodeEffect(
        Schema.fromJsonString(ReaderErrorTemplate)
      )(
        yield* fs.readFileString(
          paths.resolve(import.meta.dirname, "../dist/reader-error.json")
        )
      );

      for (const { page, load } of [
        { page: { ...flags, cafe: Option.none() }, load: unavailableDirectory },
        { page: flags, load: unavailableDirectory },
        {
          page: flags,
          load: () =>
            Promise.resolve({
              renderDirectoryPage: () =>
                Effect.die(new Error("broken Directory view")),
            }),
        },
      ]) {
        const result = yield* renderDirectoryOrError(
          page,
          assets,
          load,
          (error) => renderReaderError(template, error, "test-reader-build")
        );

        const document = parseMarkup(
          renderDocument(result.application, assets)
        );

        expect(result.status).toBe(500);
        expect(document.querySelector("main h1")?.textContent).toContain(
          "Directory could not load"
        );
        expect(document.querySelector(`#${directoryHandoffId}`)).toBeNull();
        expect(document.querySelector('header a[href="/"]')).not.toBeNull();
      }
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect("an invalid handoff logs once and leaves the SSR links usable", () =>
  Effect.gen(function* invalidDirectoryHandoff() {
    const page = parseMarkup(`
      <div id="${directoryRootId}"><a href="/news">News</a></div>
      <script type="application/json" id="${directoryHandoffId}">{"props":{}}</script>
    `);

    const link = page.querySelector("a");
    const logMessages: unknown[] = [];

    const logger = Logger.make(({ logLevel, message }) => {
      logMessages.push({ logLevel, message });
    });

    yield* hydrateDirectory(page).pipe(Effect.provide(Logger.layer([logger])));

    expect(logMessages).toEqual([
      {
        logLevel: "Error",
        message: ["Directory hydration failed: invalid handoff"],
      },
    ]);
    expect(page.querySelector("a")).toBe(link);
    expect(link?.getAttribute("href")).toBe("/news");
    expect(page.querySelector("[data-hydrated]")).toBeNull();
  })
);

it.live(
  "hostile project text stays in the Directory handoff and round-trips",
  () =>
    Effect.gen(function* directoryHandoffEscaping() {
      const { flags } = yield* directoryFlags;

      const summary =
        "start </script><!-- <img data-handoff-probe> \u2028 \u2029 end";

      const props = {
        projects: [{ ...cafeProject("escape-probe", []), summary }],
        selected: [],
      };

      const application = yield* renderDirectoryPage(flags, props, assets);
      const html = renderDocument(withReaderHead(application, flags), assets);
      const document = parseMarkup(html);

      const payloads = document.querySelectorAll(
        `script#${directoryHandoffId}[type="application/json"]`
      );

      const payload = payloads[0]?.textContent ?? "";
      expect(payloads).toHaveLength(1);
      expect(document.querySelector("[data-handoff-probe]")).toBeNull();
      expect(payload).not.toMatch(/[<\u2028\u2029]/u);

      const restored = yield* Schema.decodeEffect(
        Schema.fromJsonString(DirectoryHandoff)
      )(payload);

      expect(restored.props).toEqual(props);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.layer(TestHost.layer())("directory hydration", (test) => {
  test.effect(
    "adopts SSR project props and keeps the toggle node when the keyed list changes",
    () =>
      Effect.gen(function* directorySsr() {
        const { projects } = directoryHome;
        const selected = CafeLetter.make("alchemy");

        const hydrated = yield* ssr(DirectoryPage, {
          projects,
          selected: [selected],
        });

        expect(hydrated.adopted).toEqual(["/DirectoryPage"]);
        expect(projectLinks(hydrated.container)).toEqual(
          filterCafeProjects(projects, [selected]).map((project) => project.url)
        );
        expect(hydrated.container.querySelector("select, option")).toBeNull();
        expect(
          [...hydrated.container.querySelectorAll("button[aria-pressed]")].map(
            (button) => button.getAttribute("aria-pressed")
          )
        ).toEqual(cafeLetters.map((letter) => String(letter === selected)));

        const toggle = yield* Effect.fromOption(
          Option.fromNullishOr(
            hydrated.container.querySelector<HTMLButtonElement>(
              'button[aria-pressed="true"]'
            )
          )
        );

        toggle.click();
        yield* TestHost.settle;
        expect(toggle.getAttribute("aria-pressed")).toBe("false");
        expect(projectLinks(hydrated.container)).toEqual(
          projects.map((project) => project.url)
        );
      })
  );
});
