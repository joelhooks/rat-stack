import { Effect, FileSystem, Path } from "effect";

import { buildError } from "./content-error.ts";

export const securityAuditContent = Effect.fn("securityAuditContent")(
  function* securityAuditContent(root: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = "skills/security-audit";

    const readText = (name: string) =>
      fs
        .readFileString(path.join(root, directory, name))
        .pipe(
          Effect.mapError((cause) =>
            buildError("read skill file", `${directory}/${name}`, cause)
          )
        );

    const names = yield* fs
      .readDirectory(path.join(root, directory))
      .pipe(
        Effect.mapError((cause) =>
          buildError("read skill directory", directory, cause)
        )
      );

    const files = yield* Effect.forEach(
      names.toSorted(),
      Effect.fn(function* readSecurityAuditFile(name: string) {
        const text = yield* readText(name);

        return { name, text };
      })
    );

    const assets = files.map(({ name, text }) => ({
      base64: Buffer.from(text).toString("base64"),
      path: `/skills/security-audit/${name}`,
    }));

    let body = yield* readText("SKILL.md");

    for (const file of files) {
      body = body.replaceAll(
        `](${file.name})`,
        `](/skills/security-audit/${file.name})`
      );
    }

    const guide = yield* readText("RAT-STACK.md");

    const guideBody = guide
      .split("\n")
      .map((line) => (line.startsWith("#") ? `#${line}` : line))
      .join("\n");

    const published = `${body}\n\n## Upstream credit\n\nVendored from [Cloudflare security-audit-skill](https://github.com/cloudflare/security-audit-skill/tree/c1c8a8c1471069fb0e188eeaff69b8e8db6564a8), commit c1c8a8c1471069fb0e188eeaff69b8e8db6564a8. MIT licensed. Copyright (c) 2025-2026 Cloudflare, Inc. See [LICENSE](/skills/security-audit/LICENSE) and [UPSTREAM.md](/skills/security-audit/UPSTREAM.md).\n\n${guideBody}\n\n## Skill files\n\n${files.map((file) => `- [${file.name}](/skills/security-audit/${file.name})`).join("\n")}\n`;

    return { assets, published };
  }
);
