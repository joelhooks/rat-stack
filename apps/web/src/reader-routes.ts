export const readerRoutePaths: readonly string[] = [
  "/",
  "/lore/services-capture-dependencies",
  "/learn",
];

export const isReaderRoutePath = (path: string) =>
  readerRoutePaths.includes(path) ||
  path === "/lore" ||
  path.startsWith("/lore/") ||
  path === "/systems" ||
  path.startsWith("/systems/") ||
  path === "/skills" ||
  path.startsWith("/skills/") ||
  path === "/prompts" ||
  /^\/prompts\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(path);
