export const readerSettingsStorageKey = "rat-reader-settings";

export const readerSettingsKeys = [
  "theme",
  "prose",
  "size",
  "measure",
  "accent",
] as const;

export const readerSettingsScript = `(()=>{try{const s=JSON.parse(localStorage.getItem("${readerSettingsStorageKey}")??"{}");for(const k of[${readerSettingsKeys.map((key) => `"${key}"`).join(",")}]){const v=s[k];if(typeof v==="string"&&/^[a-z0-9]{1,8}$/.test(v))document.documentElement.setAttribute("data-"+k,v)}}catch{}})();`;

export const readerSettingsScriptHash =
  "'sha256-zPBwLvBVv3Yv79L4wLF2ENV+BC45klUcQ5H06Lp53ns='";
