const SENSITIVE_KEY_PARTS = [
  "auth",
  "code",
  "email",
  "key",
  "mail",
  "otp",
  "pass",
  "secret",
  "session",
  "sig",
  "token",
] as const;

export const isSensitiveKey = (key: string) => {
  const lowered = key.toLowerCase();

  return SENSITIVE_KEY_PARTS.some((part) => lowered.includes(part));
};

export const capturedQuery = (params: URLSearchParams) => {
  const grouped = new Map<string, string[]>();

  for (const [key, value] of params) {
    if (!isSensitiveKey(key)) {
      grouped.set(key, [...(grouped.get(key) ?? []), value]);
    }
  }

  return Object.fromEntries(grouped);
};

const originAndPath = (url: URL) => `${url.origin}${url.pathname}`;

export const referrerOf = (value: string | undefined) =>
  value !== undefined && URL.canParse(value)
    ? originAndPath(new URL(value))
    : undefined;

type RequestFact =
  | boolean
  | number
  | string
  | Readonly<Record<string, readonly string[]>>
  | undefined;

export const withoutUndefined = (
  record: Readonly<Record<string, RequestFact>>
) =>
  Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  );
