export const institutePath = "/institute";

export const instituteSitemapPath = `${institutePath}/sitemap.xml`;

export const isInstitutePath = (path: string) =>
  path === institutePath || path.startsWith(`${institutePath}/`);
