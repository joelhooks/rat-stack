export const contentSecurityPolicy = (
  formAction: "'none'" | "'self'",
  scriptHash?: string
) =>
  `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src https://static.cloudflareinsights.com${scriptHash === undefined ? "" : ` '${scriptHash}'`}; connect-src 'self' https://cloudflareinsights.com; base-uri 'none'; form-action ${formAction}; frame-ancestors 'none'`;
