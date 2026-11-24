import type { SkillBundle } from "@rat-stack/capability/skill-bundle";
import { Effect, Layer } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import type { ContentStore } from "./content-store.js";

const root = "/.well-known/agent-skills/executor";

export const executorSkillsIndexPath = `${root}/index.json`;

const index = (skills: typeof SkillBundle.Type) => ({
  skills: skills.map(({ files, name, version }) => ({
    files: files.map(({ path }) => path),
    name,
    version,
  })),
});

const fileUrl = (name: string, path: string) =>
  `${root}/${name}/${path.split("/").map(encodeURIComponent).join("/")}`;

export const executorSkillRoutes = (store: ContentStore["Service"]) =>
  Layer.merge(
    HttpRouter.add(
      "GET",
      executorSkillsIndexPath,
      store.skills.pipe(
        Effect.map((skills) => HttpServerResponse.jsonUnsafe(index(skills)))
      )
    ),
    HttpRouter.add("GET", `${root}/*`, (request) =>
      store.skills.pipe(
        Effect.map((skills) => {
          const { pathname } = new URL(request.url, "https://ratstack.sh");

          for (const skill of skills) {
            const file = skill.files.find(
              ({ path }) => fileUrl(skill.name, path) === pathname
            );

            if (file !== undefined) {
              return HttpServerResponse.text(file.text, {
                contentType: "text/plain; charset=utf-8",
              });
            }
          }

          return HttpServerResponse.text("Not found.\n", { status: 404 });
        })
      )
    )
  );
