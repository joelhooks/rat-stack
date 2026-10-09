export const readerRoutePaths: readonly string[] = [
  "/",
  "/lore/services-capture-dependencies",
  "/learn",
  "/news",
  "/directory",
];

export const readerBodyRoutePaths: readonly string[] = [
  "/AGENTS.md",
  "/README.md",
  "/VISION.md",
  "/debt.md",
  "/glossary",
  "/log",
  "/log.md",
  "/pins.md",
  "/resources/effect-4-reference-projects",
  "/resources/lint-rule-limits",
  "/resources/peers",
  "/resources/same-version-repos",
  "/resources/schema-projections-and-code-mode",
  "/tokenmaxx",
  "/vendor/README.md",
];

export const isWorkerFirstReaderRoute = (path: string) =>
  path === "/prompts" || path.startsWith("/prompts/");

export const readerNoStoreRoutePaths: readonly string[] = ["/tokenmaxx"];

export const isReaderRoutePath = (path: string) =>
  readerRoutePaths.includes(path) ||
  readerBodyRoutePaths.includes(path) ||
  path === "/lore" ||
  path.startsWith("/lore/") ||
  path === "/systems" ||
  path.startsWith("/systems/") ||
  path === "/skills" ||
  path.startsWith("/skills/") ||
  path === "/prompts" ||
  /^\/prompts\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(path);
