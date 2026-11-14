import { findRepoRoot } from "#shared/core/context.ts";

import { launchPi, planLaunch } from "./lib/pi.ts";

// pnpm pi [--role <name>] [--exercise <id>] [--fresh] [...pi args]
const repoRoot = findRepoRoot();
try {
  const launch = await planLaunch(process.argv.slice(2), repoRoot);
  if (launch.notice !== null) {
    console.error(launch.notice);
  }
  process.exitCode = await launchPi(launch, repoRoot);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    "Usage: pnpm pi [--role <name>] [--exercise <id>] [--fresh] [...pi args]"
  );
  process.exitCode = 2;
}
