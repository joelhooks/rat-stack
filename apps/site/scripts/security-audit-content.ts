import type { SkillBundle } from "@rat-stack/capability/skill-bundle";
import { Effect } from "effect";

import { buildError } from "./content-error.ts";

const auditPath = (name: string) => `/skills/security-audit/${name}`;

export const securityAuditContent = Effect.fn("securityAuditContent")(
  function* securityAuditContent(bundle: typeof SkillBundle.Type) {
    const audit = bundle.find(({ name }) => name === "security-audit");
    const guide = audit?.files.find(({ path }) => path === "RAT-STACK.md");

    if (audit === undefined || guide === undefined) {
      return yield* buildError(
        "publish defensive skill",
        "skills/security-audit",
        "The public bundle needs the security audit skill and its boundary map"
      );
    }

    const assets = audit.files.map(({ path, text }) => ({
      base64: Buffer.from(text).toString("base64"),
      path: auditPath(path),
    }));

    let body = audit.files[0].text;

    for (const { path } of audit.files) {
      body = body.replaceAll(`](${path})`, `](${auditPath(path)})`);
    }

    const guideBody = guide.text
      .split("\n")
      .map((line) => (line.startsWith("#") ? `#${line}` : line))
      .join("\n");

    const published = `${body}\n\n${guideBody}\n\n## Skill files\n\n${audit.files.map(({ path }) => `- [${path}](${auditPath(path)})`).join("\n")}\n`;

    return { assets, published };
  }
);
