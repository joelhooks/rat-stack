export const contentSecurityPolicy = (
  formAction: "'none'" | "'self'",
  shield = false,
  scriptHash?: string
) =>
  `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src https://static.cloudflareinsights.com${scriptHash === undefined ? "" : ` '${scriptHash}'`}${shield ? " https://www.postshiba.com" : ""}; connect-src https://cloudflareinsights.com${shield ? " https://www.postshiba.com https://postshiba.com" : ""}${shield ? "; worker-src blob:" : ""}; base-uri 'none'; form-action ${formAction}; frame-ancestors 'none'`;
