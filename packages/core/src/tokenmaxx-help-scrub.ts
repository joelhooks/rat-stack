export const REDACTED = "[redacted]";

export const EMAIL = "[email]";

const lowerSecretWord = String.raw`(?:key|token|secret|passw(?:or)?d|auth|credentials?)`;

const capitalSecretWord = String.raw`(?:Key|KEY|Token|TOKEN|Secret|SECRET|Passw(?:or)?d|PASSW(?:OR)?D|Auth|AUTH|Credentials?|CREDENTIALS?)`;

const secretName = String.raw`[A-Za-z0-9_.-]*?(?:${lowerSecretWord}|${capitalSecretWord})(?:[_.-][A-Za-z0-9]+)*(?![A-Za-z0-9])`;

const quoted = String.raw`"(?:[^"\\\n]|\\.)*"|'[^'\n]*'`;

const pemBlock =
  /-----BEGIN [A-Z0-9 ]{1,40}-----[\s\S]*?(?:-----END [A-Z0-9 ]{1,40}-----|$)/gu;

const urlCredentials = /(?<=[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+(?=@)/giu;

const emailAddress =
  /(?<![A-Za-z0-9._%+-])(?!git@)[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/gu;

const hexRun = /(?<![A-Za-z0-9])[0-9A-Fa-f]{32,}(?![A-Za-z0-9])/gu;

const jwt =
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]*)?/gu;

const bearer =
  /(?<scheme>(?<![A-Za-z0-9])bearer\s+)(?!\[redacted\])[^\s"',;]{8,}/giu;

const basic =
  /(?<scheme>(?<![A-Za-z0-9])basic\s+)[A-Za-z0-9+/]{12,}={0,2}(?![A-Za-z0-9+/=])/giu;

const prefixedKey =
  /(?<![A-Za-z0-9])(?:(?:sk[-]ant[-]|sk[-]|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|xox[a-z]-|glpat-)[A-Za-z0-9_-]{8,}|(?:AKIA|ASIA)[A-Z0-9]{12,}|AIza[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{30,})/gu;

const assignment = new RegExp(
  String.raw`(?<name>(?<open>["']?)(?<![A-Za-z0-9_.-])${secretName}\k<open>\s*(?::|=>|=)\s*)(?!\[redacted\])(?:${quoted}|[^\s,;&}\]"']+)`,
  "gu"
);

const flagValue = new RegExp(
  String.raw`(?<flag>(?<![A-Za-z0-9-])--?(?=[A-Za-z])${secretName}(?:=|\s+))(?!\[redacted\])(?:${quoted}|[^\s"'-][^\s"']*)`,
  "gu"
);

const longRun = /[A-Za-z0-9+/_=-]{32,}/gu;

const entropyOf = (text: string) => {
  const counts = new Map<string, number>();

  for (const character of text) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }

  let bits = 0;

  for (const count of counts.values()) {
    const share = count / text.length;
    bits -= share * Math.log2(share);
  }

  return bits;
};

const mixesClasses = (run: string) =>
  /[A-Z]/u.test(run) && /[a-z]/u.test(run) && /\d/u.test(run);

const wordSegment = /^[A-Za-z][a-z]{2,}(?:[_-][a-z]+)*$/u;

const readsAsPath = (run: string) => {
  const segments = run.split("/").filter((segment) => segment.length > 0);
  const words = segments.filter((segment) => wordSegment.test(segment));

  return segments.length > 1 && words.length * 2 >= segments.length;
};

const looksRandom = (run: string) =>
  mixesClasses(run) &&
  !readsAsPath(run) &&
  entropyOf(run.replaceAll("/", "")) >= 4;

export interface Scrubbed {
  readonly redacted: boolean;
  readonly text: string;
}

export const scrubSecrets = (text: string): Scrubbed => {
  const scrubbed = text
    .replaceAll(pemBlock, REDACTED)
    .replaceAll(urlCredentials, REDACTED)
    .replaceAll(emailAddress, EMAIL)
    .replaceAll(jwt, REDACTED)
    .replaceAll(prefixedKey, REDACTED)
    .replaceAll(bearer, `$<scheme>${REDACTED}`)
    .replaceAll(basic, `$<scheme>${REDACTED}`)
    .replaceAll(assignment, `$<name>${REDACTED}`)
    .replaceAll(flagValue, `$<flag>${REDACTED}`)
    .replaceAll(hexRun, REDACTED)
    .replaceAll(longRun, (run) => (looksRandom(run) ? REDACTED : run));

  return { redacted: scrubbed !== text, text: scrubbed };
};
