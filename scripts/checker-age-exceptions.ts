export interface CheckerChange {
  readonly name: string;
  readonly newVersion: string;
  readonly oldVersion: string;
}

const checkerPackages = (name: string): readonly string[] => {
  if (name === "tsrs") {
    return [
      name,
      ...[
        "darwin-arm64",
        "darwin-x64",
        "linux-arm64-gnu",
        "linux-arm64-musl",
        "linux-x64-gnu",
        "linux-x64-musl",
        "win32-x64",
      ].map((platform) => `@tsrs/${platform}`),
    ];
  }

  return name === "@yielded/effect-tsrs"
    ? [
        name,
        ...[
          "linux-x64",
          "linux-arm64",
          "darwin-x64",
          "darwin-arm64",
          "win32-x64",
        ].map((platform) => `${name}-${platform}`),
      ]
    : [name];
};

export const checkerAgeExceptions = (
  original: string,
  changes: readonly CheckerChange[]
): string => {
  if (changes.length === 0) {
    return original;
  }

  const lines = original.split("\n");
  const start = lines.indexOf("minimumReleaseAgeExclude:");

  const end = lines.findIndex(
    (line, index) => index > start && /^[^\s#]/u.test(line)
  );

  const before =
    start === -1
      ? `${original}${original.endsWith("\n") ? "" : "\n"}`
          .split("\n")
          .slice(0, -1)
      : lines.slice(0, start);

  const after =
    start === -1 ? [""] : lines.slice(end === -1 ? lines.length : end);

  let entries =
    start === -1 ? [] : lines.slice(start + 1, end === -1 ? lines.length : end);

  const quote =
    entries
      .map((line) => /^\s+-\s+(?<quote>["'])/u.exec(line)?.groups?.quote)
      .find((value) => value !== undefined) ?? '"';

  for (const { name, oldVersion, newVersion } of changes) {
    for (const entry of checkerPackages(name)) {
      const oldEntry = `${entry}@${oldVersion}`;
      const newEntry = `${entry}@${newVersion}`;
      let found = false;
      entries = entries.flatMap((line) => {
        const match =
          /^(?<prefix>\s+-\s+)(?<quote>["']?)(?<entry>[^"'\s]+)\k<quote>(?<suffix>[ \t]*(?:#.*)?)$/u.exec(
            line
          )?.groups;

        if (match?.entry !== oldEntry && match?.entry !== newEntry) {
          return [line];
        }

        if (found) {
          return [];
        }

        found = true;

        return [
          `${match.prefix}${match.quote}${newEntry}${match.quote}${match.suffix}`,
        ];
      });

      if (!found) {
        entries.unshift(`  - ${quote}${newEntry}${quote}`);
      }
    }
  }

  return [...before, "minimumReleaseAgeExclude:", ...entries, ...after].join(
    "\n"
  );
};
