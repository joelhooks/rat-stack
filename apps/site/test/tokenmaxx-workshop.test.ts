import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Workshop, publishWorkshop } from "@rat-stack/core/tokenmaxx-workshop";
import { UnknownExercise } from "@rat-stack/core/workshop-contracts";
import {
  WorkshopDirectory,
  listExercises,
  readExercise,
  workshopLinks,
  workshopPrep,
} from "@rat-stack/core/workshop-directory";
import { Effect, FileSystem, Path, Schema } from "effect";

import { emitAssets } from "../scripts/emit-assets.ts";
import { syncExercises } from "../scripts/tokenmaxx-sync.ts";
import { buildWorkshop } from "../scripts/tokenmaxx-workshop.ts";

it.effect(
  "publishes only reviewed public links and gates the starter separately",
  () =>
    Effect.gen(function* verifyPublicLinks() {
      const workshop = yield* Schema.decodeUnknownEffect(Workshop)({
        links: {
          links: [
            {
              public: true,
              repo: "example/public",
              url: "https://example.com/public",
              why: "Public",
            },
            {
              public: false,
              repo: "example/private",
              url: "https://example.com/private",
              why: "Private",
            },
            {
              needs: "starterPublic",
              public: true,
              repo: "example/starter",
              url: "https://example.com/starter",
              why: "Starter",
            },
            {
              public: true,
              repo: "example/rat-king-infra",
              url: "https://example.com/rat-king-infra",
              why: "Never",
            },
            {
              public: true,
              repo: "example/herdr-worktrees",
              url: "https://example.com/herdr-worktrees",
              why: "Never",
            },
          ],
          never: [],
          note: "",
          status: "published",
        },
        prep: {
          items: [
            { id: "public", item: "Public prep", proof: "check" },
            {
              id: "starter",
              item: "Starter prep",
              needs: "starterPublic",
              proof: "check starter",
            },
          ],
          note: "",
          status: "published",
        },
        runs: [],
        starterPublic: false,
      });

      const privateStarter = publishWorkshop(workshop, []);
      expect(privateStarter.links.links.map((link) => link.repo)).toStrictEqual(
        ["example/public"]
      );
      expect(privateStarter.prep.items.map((item) => item.id)).toStrictEqual([
        "public",
      ]);

      const publicStarter = publishWorkshop(
        { ...workshop, starterPublic: true },
        []
      );

      expect(publicStarter.links.links.map((link) => link.repo)).toStrictEqual([
        "example/public",
        "example/starter",
      ]);
      expect(publicStarter.prep.items.map((item) => item.id)).toStrictEqual([
        "public",
        "starter",
      ]);
    })
);

const unpublished = "UNPUBLISHED_WORKSHOP_CANARY";

const fixture = {
  links: {
    links: [
      {
        public: true,
        repo: "example/repo",
        url: "https://example.com",
        why: unpublished,
      },
    ],
    never: [],
    note: unpublished,
    status: "draft",
  },
  prep: {
    items: [{ id: "draft", item: unpublished, proof: unpublished }],
    note: unpublished,
    status: "draft",
  },
  runs: [],
  starterPublic: false,
};

it.layer(NodeServices.layer)((nodeIt) => {
  describe("workshop publication boundary", () => {
    nodeIt.effect(
      "never emits drafts into pages, assets or capability answers",
      () =>
        Effect.gen(function* verifyDraftBoundary() {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* fs.makeTempDirectoryScoped();
          yield* fs.makeDirectory(path.join(root, ".brain/data/tokenmaxx"), {
            recursive: true,
          });
          yield* fs.writeFileString(
            path.join(root, ".brain/data/tokenmaxx/workshop.json"),
            JSON.stringify(fixture)
          );

          const directory = path.join(
            root,
            ".brain/resources/tokenmaxx/exercises"
          );

          yield* fs.makeDirectory(directory, { recursive: true });
          yield* fs.writeFileString(
            path.join(directory, "draft.svx"),
            `---\nid: draft\nsection: awakes\ntitle: ${unpublished}\nstatus: draft\n---\n${unpublished}`
          );
          yield* fs.writeFileString(
            path.join(directory, "live.svx"),
            "---\nid: live\nsection: awakes\ntitle: Live exercise\nstatus: published\n---\n# Live exercise\n\nA published explanation."
          );
          const workshop = yield* buildWorkshop(root);
          expect(workshop.pages.map((page) => page.routePath)).not.toContain(
            "/tokenmaxx/exercises/draft"
          );
          expect(
            workshop.pages.find((page) => page.routePath === "/tokenmaxx/prep")
              ?.source
          ).toContain("Coming soon.");
          expect(JSON.stringify(workshop)).not.toContain(unpublished);

          const answers = yield* Effect.all({
            exercises: listExercises.handler({}),
            links: workshopLinks.handler({}),
            prep: workshopPrep.handler({}),
            read: readExercise.handler({ id: "live" }),
          }).pipe(Effect.provide(WorkshopDirectory.layer(workshop.data)));

          expect(
            answers.exercises.exercises.map((exercise) => exercise.id)
          ).toStrictEqual(["live"]);
          expect(answers.links).toStrictEqual({
            links: [],
            status: "not-yet-published",
          });
          expect(answers.prep).toStrictEqual({
            items: [],
            status: "not-yet-published",
          });
          expect(JSON.stringify(answers)).not.toContain(unpublished);

          const refused = yield* readExercise
            .handler({ id: "draft" })
            .pipe(
              Effect.provide(WorkshopDirectory.layer(workshop.data)),
              Effect.flip
            );

          expect(Schema.is(UnknownExercise)(refused)).toBe(true);
          const assets = path.join(root, "assets");

          const manifest = yield* emitAssets({
            data: [
              {
                path: "/_content/workshop.json",
                value: yield* Schema.decodeUnknownEffect(Schema.Json)(
                  workshop.data
                ),
              },
            ],
            directory: assets,
            images: [],
            pages: workshop.pages.map((page) => ({
              documentHtml: page.source,
              routePath: page.routePath,
              text: page.source,
            })),
          });

          for (const page of manifest.pages) {
            expect(
              yield* fs.readFileString(
                path.join(assets, "assets", manifest.generation, page.markdown)
              )
            ).not.toContain(unpublished);
            expect(
              yield* fs.readFileString(
                path.join(
                  assets,
                  "documents",
                  manifest.generation,
                  page.document
                )
              )
            ).not.toContain(unpublished);
          }

          expect(
            yield* fs.readFileString(
              path.join(
                assets,
                "assets",
                manifest.generation,
                "_content/workshop.json"
              )
            )
          ).not.toContain(unpublished);
        })
    );

    nodeIt.effect(
      "imports new exercises as drafts and preserves publication status on resync",
      () =>
        Effect.gen(function* verifyExerciseSync() {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* fs.makeTempDirectoryScoped();
          const starter = path.join(root, "starter");

          const explainer = path.join(
            starter,
            "exercises/01-awakes/01.1-wake/explainer"
          );

          yield* fs.makeDirectory(explainer, { recursive: true });
          yield* fs.writeFileString(
            path.join(explainer, "readme.md"),
            "# Wake\n\nFirst body.\n"
          );
          yield* syncExercises(starter, root);

          const target = path.join(
            root,
            ".brain/resources/tokenmaxx/exercises/01.1-wake.svx"
          );

          const draft = yield* fs.readFileString(target);
          expect(draft).toContain("status: draft");
          yield* fs.writeFileString(
            target,
            draft.replace("status: draft", "status: published")
          );
          yield* fs.writeFileString(
            path.join(explainer, "readme.md"),
            "# Wake\n\nUpdated body.\n"
          );
          yield* syncExercises(starter, root);
          const synced = yield* fs.readFileString(target);
          expect(synced).toContain("status: published");
          expect(synced).toContain("Updated body.");
          expect(synced).not.toContain("First body.");
        })
    );
  });
});
