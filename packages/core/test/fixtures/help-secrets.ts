import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

const base62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const base64Url = `${base62}-_`;

const base64 = `${base62}+/`;

const upperDigits = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0234567";

const digits = "0123456789";

const hex = "0123456789abcdef";

const lower = "abcdefghijklmnopqrstuvwxyz";

const modulus = 2_147_483_647;

const seeded = (seed: number) => {
  const states = [(Math.abs(seed) % (modulus - 1)) + 1];

  return () => {
    const state = ((states.at(-1) ?? 1) * 48_271) % modulus;
    states.push(state);

    return state / modulus;
  };
};

const draw = (random: () => number, alphabet: string, length: number) =>
  Array.from(
    { length },
    () => alphabet[Math.floor(random() * alphabet.length)] ?? "x"
  ).join("");

const SecretKind = Schema.Literals([
  "openai",
  "anthropic",
  "githubClassic",
  "githubOauth",
  "githubPat",
  "slack",
  "aws",
  "google",
  "bearer",
  "jwt",
  "pem",
  "envAssignment",
  "jsonField",
  "yamlField",
  "cliFlag",
  "urlCredential",
  "highEntropy",
  "lowerName",
  "slashBase64",
  "hexStandalone",
  "hexAssignment",
  "email",
]);

const lowerNames = [
  "apikey",
  "accesstoken",
  "dbpassword",
  "mypassword",
  "clientsecret",
  "authkey",
  "refreshtoken",
];

const weakValues = ["hunter2", "letmein", "changeme", "abc123", "p4ss"];

const topLevels = ["io", "dev", "org", "co.uk"];

const pick = <A>(random: () => number, choices: readonly A[], fallback: A) =>
  choices[Math.floor(random() * choices.length)] ?? fallback;

const assignmentForms = [
  (name: string, value: string) => `${name}=${value}`,
  (name: string, value: string) => `${name}: ${value}`,
  (name: string, value: string) => `"${name}": "${value}"`,
  (name: string, value: string) => `${name} = '${value}'`,
];

const assigned = (random: () => number, name: string, value: string) =>
  pick(
    random,
    assignmentForms,
    (key: string, text: string) => `${key}=${text}`
  )(name, value);

const envNames = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GITHUB_TOKEN",
  "AWS_SECRET_ACCESS_KEY",
  "DB_PASSWORD",
  "client_secret",
  "x-auth-token",
  "apiKey",
  "authToken",
  "SLACK_SIGNING_SECRET",
];

export interface PlantedSecret {
  readonly kind: typeof SecretKind.Type;
  readonly secret: string;
  readonly text: string;
}

type Planter = (
  random: () => number,
  name: string,
  body: string
) => { readonly secret: string; readonly text: string };

const whole = (secret: string) => ({ secret, text: secret });

const keyPrefix = (...parts: readonly string[]) => [...parts, ""].join("-");

const keyLabel = ["PRIVATE", "KEY"].join(" ");

const armour = (edge: string) => {
  const dashes = "-".repeat(5);

  return `${dashes}${edge} ${keyLabel}${dashes}`;
};

const rooted = (...segments: readonly string[]) => ["", ...segments].join("/");

const drive = (...segments: readonly string[]) =>
  [["C", ""].join(":"), ...segments].join("/");

const planters: Record<typeof SecretKind.Type, Planter> = {
  anthropic: (random) =>
    whole(`${keyPrefix("sk", "ant", "api03")}${draw(random, base64Url, 60)}`),
  aws: (random) => whole(`AKIA${draw(random, upperDigits, 16)}`),
  email: (random) =>
    whole(
      `${draw(random, lower, 3 + Math.floor(random() * 8))}.${draw(random, `${lower}${digits}`, 4)}@${draw(random, lower, 5 + Math.floor(random() * 4))}.${pick(random, topLevels, "io")}`
    ),
  hexAssignment: (random, name) => {
    const secret = draw(random, hex, 32 + Math.floor(random() * 33));

    return { secret, text: assigned(random, name, secret) };
  },
  hexStandalone: (random) =>
    whole(draw(random, hex, 32 + Math.floor(random() * 33))),
  lowerName: (random) => {
    const secret = pick(random, weakValues, "hunter2");

    return {
      secret,
      text: assigned(random, pick(random, lowerNames, "apikey"), secret),
    };
  },
  slashBase64: (random) => {
    const segments = Array.from(
      { length: 4 + Math.floor(random() * 3) },
      () =>
        `${draw(random, base62, 5 + Math.floor(random() * 5))}${draw(random, upperDigits, 1)}${draw(random, digits, 1)}`
    );

    return whole(`Zk9${segments.join("/")}`);
  },
  bearer: (_random, _name, body) => ({
    secret: body,
    text: `-H "Authorization: Bearer ${body}"`,
  }),
  cliFlag: (_random, _name, body) => ({
    secret: body,
    text: `pi --api-key ${body} --verbose`,
  }),
  envAssignment: (_random, name, body) => ({
    secret: body,
    text: `export ${name}=${body}`,
  }),
  githubClassic: (random) => whole(`ghp_${draw(random, base62, 36)}`),
  githubOauth: (random) => whole(`gho_${draw(random, base62, 36)}`),
  githubPat: (random) =>
    whole(`github_pat_${draw(random, base62, 22)}_${draw(random, base62, 59)}`),
  google: (random) => whole(`AIza${draw(random, base64Url, 35)}`),
  highEntropy: (random) => whole(`Q7x${draw(random, base62, 37)}`),
  jsonField: (_random, name, body) => ({
    secret: body,
    text: `{"${name}": "${body}", "ok": 1}`,
  }),
  jwt: (random) =>
    whole(
      `eyJhbGciOiJIUzI1NiJ9.eyJ${draw(random, base64Url, 40)}.${draw(random, base64Url, 43)}`
    ),
  openai: (_random, _name, body) => whole(`${keyPrefix("sk", "proj")}${body}`),
  pem: (random) => {
    const lines = Array.from({ length: 3 }, () => draw(random, base64, 64));

    return {
      secret: lines.join("\n"),
      text: [armour("BEGIN"), ...lines, armour("END")].join("\n"),
    };
  },
  slack: (random) =>
    whole(
      `xoxb-${draw(random, digits, 12)}-${draw(random, digits, 13)}-${draw(random, base62, 24)}`
    ),
  urlCredential: (_random, _name, body) => ({
    secret: body,
    text: `https://sam:${body}@registry.example.test/tokenmaxx`,
  }),
  yamlField: (_random, name, body) => ({
    secret: body,
    text: `${name}: '${body}'`,
  }),
};

const plant = (
  kind: typeof SecretKind.Type,
  seed: number,
  nameIndex: number
): PlantedSecret => {
  const random = seeded(seed);
  const name = envNames[nameIndex % envNames.length] ?? "API_KEY";
  const body = draw(random, base62, 24 + Math.floor(random() * 24));

  return { kind, ...planters[kind](random, name, body) };
};

export const plantedSecret = Arbitrary.all({
  kind: Arbitrary.schema(SecretKind),
  nameIndex: Arbitrary.schema(
    Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: 0 }))
  ),
  seed: Arbitrary.schema(Schema.Int),
}).pipe(
  Arbitrary.map(({ kind, nameIndex, seed }) => plant(kind, seed, nameIndex))
);

const noiseWord = Arbitrary.schema(
  Schema.Literals([
    "error",
    "ERR!",
    "npm",
    "code",
    "ENOENT",
    "at",
    "node:internal/modules/esm/resolve:272",
    rooted("Users", "sam", "tokenmaxx"),
    "tokenmaxx:",
    "pnpm",
    "install",
    "failed",
    "command",
    "not",
    "found",
    "git:",
    "xcode-select",
    "warn",
    "deprecated",
    "v24.18.0",
    "11.3.0",
    "PASS",
    "PASS:",
    "Done:",
    "the",
    "fence",
    "holds.",
    "exit",
    "1",
    "herdr",
    "--version",
    "~/.local/bin",
    "PATH",
    "Pi",
    "/login",
    "/model",
    "tokens:",
    "50k",
    "session",
    "Authentication",
    "keyboard",
    "a3f9c2e",
    "123e4567-e89b-12d3-a456-426614174000",
    "@alchemy.run+cloudflare@2.0.0-beta.87",
    "git@github.com:joelhooks/rat-stack.git",
    rooted("home", "sam", "Code", "v24", "tokenmaxx", "node_modules", "pnpm"),
    rooted("Users", "sam", "Library", "pnpm", "global", "5", "node_modules"),
    "apps/site/src/Workshop2Help/DeskDurableObject",
    rooted("Users", "SamJones2", "Code", "tokenmaxx-workshop", "packages"),
    drive(
      "Users",
      "Sam",
      "AppData",
      "Roaming",
      "npm",
      "node_modules",
      "pnpm11"
    ),
  ])
);

const separator = Arbitrary.schema(Schema.Literals([" ", "\n", "  ", "\t"]));

export const noise = Arbitrary.array(
  Arbitrary.all([noiseWord, separator]).pipe(
    Arbitrary.map(([word, gap]) => `${word}${gap}`)
  ),
  { maxLength: 30 }
).pipe(Arbitrary.map((words) => words.join("")));

export const windowsOf = (secret: string, size: number) =>
  Array.from({ length: Math.max(1, secret.length - size + 1) }, (_, start) =>
    secret.slice(start, start + size)
  ).filter((window) => window.length === size || secret.length < size);
