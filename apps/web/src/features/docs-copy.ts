export const searchCopy = {
  agents: "lists the search and read tools for agents.",
  description:
    "Search rat-stack's rules, lore, skills, and prompts, then open the matching page.",
  heading: "Search the docs",
  intro:
    "Search the rules, lore, skills, and prompts. Open a match to read its page.",
  noscript:
    "Search runs in your browser and needs JavaScript. Without it, start at the agent guide.",
};

export const resultCount = (count: number) =>
  `${count} ${count === 1 ? "result" : "results"}`;
