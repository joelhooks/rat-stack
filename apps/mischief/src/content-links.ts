export const markdownDiscoveryLinks = (pagePath: string) =>
  [
    {
      href: pagePath === "/log" ? "/log.md" : pagePath,
      rel: "alternate",
      type: "text/markdown",
    },
    { href: "/llms.txt", rel: "describedby", type: "text/markdown" },
  ] as const;
