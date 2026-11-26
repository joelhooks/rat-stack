export const newsOrder = {
  newest: {
    description: "Reviewed stack news, newest first.",
    heading: "Latest news",
    href: "/news/latest",
    label: "Latest first",
  },
  rank: {
    href: "/news",
    label: "Ranked by interest",
  },
} as const;

export const otherNewsOrder = (sort: keyof typeof newsOrder) =>
  newsOrder[sort === "rank" ? "newest" : "rank"];
