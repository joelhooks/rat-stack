const markdownTokens =
  /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|\]\(\s*(?:<(?<angle>[^>]+)>|(?<plain>[^)\s]+))(?:\s+[^)]*)?\)|^\s*\[[^\]]+\]:\s*(?:<(?<referenceAngle>[^>]+)>|(?<reference>\S+))/gmu;

export const canonicalMarkdownLinks = (
  text: string,
  route: string,
  origin: string
): string =>
  text.replaceAll(markdownTokens, (token) => {
    const href =
      /\]\(\s*(?:<(?<angle>[^>]+)>|(?<plain>[^\s)]+))|^\s*\[[^\]]+\]:\s*(?:<(?<referenceAngle>[^>]+)>|(?<reference>\S+))/u.exec(
        token
      );

    const target =
      href?.groups?.angle ??
      href?.groups?.plain ??
      href?.groups?.referenceAngle ??
      href?.groups?.reference;

    if (
      token.startsWith("`") ||
      token.startsWith("~~~") ||
      target === undefined
    ) {
      return token;
    }

    const resolved = new URL(target, new URL(route, origin));

    return resolved.origin === origin
      ? token.replace(
          target,
          `${resolved.pathname}${resolved.search}${resolved.hash}`
        )
      : token;
  });
