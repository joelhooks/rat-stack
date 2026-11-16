import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyUpdate,
  fingerprint,
  type History,
  historyFile,
} from "./lib/update.ts";

// Brings a copy of the starter up to this one. Run from the copy's folder,
// with this newer copy fetched into .workshop-state/update/:
//
//   npx -y tiged joelhooks/rat-stack/examples/tokenmaxx-starter .workshop-state/update --force && node .workshop-state/update/scripts/update.ts
//
// See ./lib/update.ts for what it touches. Then `pnpm install`.

const source = dirname(dirname(fileURLToPath(import.meta.url)));
const target = process.cwd();
const backup = process.argv.includes("--backup");
const out = (line: string) => console.log(line);

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, "utf8"));
const history = readJson(join(source, historyFile)) as History;
const pkg = readJson(join(source, "package.json")) as { version?: string };

const command = `node ${relative(target, join(source, "scripts", "update.ts"))}`;

if (resolve(source) === resolve(target)) {
  out(
    "Run this from the starter folder you want to update, not from the new copy."
  );
  process.exit(2);
}
let targetName: unknown = null;
try {
  targetName = (readJson(join(target, "package.json")) as { name?: unknown })
    .name;
} catch {
  // No package.json: not a starter folder.
}
if (targetName !== "tokenmaxx-starter") {
  out(
    `${target} isn't a tokenmaxx-starter folder (its package.json says otherwise). Run this from that folder.`
  );
  process.exit(2);
}

const result = applyUpdate(target, source, history, {
  backup,
  now: new Date(),
});
if (!result.ok) {
  out("Nothing changed. You edited files the new version can't run without:");
  result.blocked.forEach((path) => out(`  ${path}`));
  out(
    "To move every file you changed into .workshop-state/update-backup/ and update anyway:"
  );
  out(`  ${command} --backup`);
  process.exit(1);
}

const { plan, backupDir } = result;
if (backupDir !== null) {
  out(`Moved your changed files to ${backupDir}/.`);
}
if (plan.kept.length > 0 || plan.leftover.length > 0) {
  out("Kept as you left them (you changed them):");
  [...plan.kept, ...plan.leftover].forEach((path) => out(`  ${path}`));
}
const changes = plan.write.length + plan.remove.length;
out(
  changes === 0
    ? "Already up to date."
    : `Updated ${plan.write.length} file${plan.write.length === 1 ? "" : "s"}${plan.remove.length > 0 ? `, removed ${plan.remove.length}` : ""}.`
);
out(`Now at tokenmaxx-starter ${pkg.version ?? "?"} (${fingerprint(source)}).`);

out("Running pnpm install...");
const install = spawnSync("pnpm", ["install"], {
  cwd: target,
  stdio: "inherit",
});
if (install.status !== 0) {
  out(
    "pnpm install failed. Fix what it says, run `pnpm install`, then `pnpm ex 00.1 check`."
  );
  process.exit(1);
}
rmSync(source, { recursive: true, force: true });
out("Done. Next: pnpm ex 00.1 check");
