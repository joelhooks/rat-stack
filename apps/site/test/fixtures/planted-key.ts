const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const body = Array.from(
  { length: 32 },
  (_, index) => alphabet[(index * 37 + 11) % alphabet.length] ?? "x"
).join("");

export const plantedOpenAiKey = ["sk", "proj", body].join("-");
