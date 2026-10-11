export const isSystemsSkillsRoute = (route: string) =>
  /^\/(?:systems|skills)(?:\/[^/]+)?$/u.test(route);
