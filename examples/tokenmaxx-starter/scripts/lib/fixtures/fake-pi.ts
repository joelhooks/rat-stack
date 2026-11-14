import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// Launcher test fixture: stands in for Pi. Runs in the launcher's cwd.
//   (no args)      stays alive until signalled
//   --exit <code>  exits with that code
//   --print-env    writes fake-pi-env.json: TMX_SESSION as this process and
//                  a child process it runs see it
//   --clean-term   on SIGTERM, shuts down cleanly with exit code 0, as Pi does;
//                  writes fake-pi-ready.json once it listens

const args = process.argv.slice(2);

if (args.includes("--clean-term")) {
  process.on("SIGTERM", () => process.exit(0));
  writeFileSync(join(process.cwd(), "fake-pi-ready.json"), "true");
}

if (args.includes("--print-env")) {
  const child = execFileSync(
    process.execPath,
    ["-e", "process.stdout.write(process.env.TMX_SESSION ?? '')"],
    { encoding: "utf8" }
  );
  writeFileSync(
    join(process.cwd(), "fake-pi-env.json"),
    JSON.stringify({ pi: process.env["TMX_SESSION"] ?? null, child })
  );
}

const exit = args.indexOf("--exit");
if (exit === -1) {
  setInterval(() => undefined, 1000);
} else {
  process.exitCode = Number(args[exit + 1] ?? "0");
}
