export const turboCacheConfig = {
  repository: "joelhooks/rat-stack",
  retentionDays: 7,
  stack: "RatStack",
  stateStoreName: "alchemy-state-store-ratstack-state-store",
  teams: ["rat-stack"],
} as const;

export const tokenId = (team: string) => `TurboCacheToken-${team}`;
