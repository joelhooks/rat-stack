export const contentSecurityPolicy = (formAction: "'none'" | "'self'") =>
  `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src https://static.cloudflareinsights.com; connect-src https://cloudflareinsights.com; base-uri 'none'; form-action ${formAction}; frame-ancestors 'none'`;
