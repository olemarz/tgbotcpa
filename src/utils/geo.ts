// src/utils/geo.ts

export type GeoMode = 'any' | 'whitelist' | 'blacklist';

/**
 * Пресеты регионов → массив ISO2-кодов стран (верхний регистр).
 * При необходимости пополняй наборами.
 */
export const REGION_PRESETS: Record<string, string[]> = {
  CIS:  ["RU","BY","KZ","KG","UZ","TJ","TM","AM","AZ","GE","UA","MD"], // СНГ (+ рядом)
  EU:   ["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"],
  US:   ["US"],
  LATAM:["AR","BO","BR","CL","CO","CR","CU","DO","EC","SV","GT","HN","MX","NI","PA","PY","PE","PR","UY","VE"],
  MENA: ["AE","BH","DZ","EG","IQ","IR","IL","JO","KW","LB","LY","MA","OM","PS","QA","SA","SY","TN","TR","YE"],
  APAC: ["AU","BD","BN","KH","CN","HK","IN","ID","JP","KR","LA","MY","MM","NP","NZ","PK","PH","SG","LK","TH","TW","VN"]
};

/**
 * Небольшой словарь синонимов: рус/англ названия → ISO2.
 * Можно расширять по мере встречаемости.
 */
const COUNTRY_SYNONYMS: Record<string, string> = {
  // RU/CIS
  "россия":"RU","рф":"RU","russia":"RU",
  "беларусь":"BY","belarus":"BY",
  "казахстан":"KZ","kazakhstan":"KZ",
  "украина":"UA","ukraine":"UA",
  "грузия":"GE","georgia":"GE",
  "армения":"AM","armenia":"AM",
  "азербайджан":"AZ","azerbaijan":"AZ",
  "молдова":"MD","moldova":"MD",
  "кыргызстан":"KG","киргизия":"KG","kyrgyzstan":"KG",
  "таджикистан":"TJ","tajikistan":"TJ",
  "туркменистан":"TM","turkmenistan":"TM",
  "узбекистан":"UZ","uzbekistan":"UZ",

  // EN/EU, etc.
  "germany":"DE","германия":"DE",
  "italy":"IT","италия":"IT",
  "france":"FR","франция":"FR",
  "spain":"ES","испания":"ES",
  "poland":"PL","польша":"PL",
  "netherlands":"NL","нидерланды":"NL","голландия":"NL",
  "portugal":"PT","португалия":"PT",
  "ireland":"IE","ирландия":"IE",
  "sweden":"SE","швеция":"SE",
  "finland":"FI","финляндия":"FI",

  // US
  "сша":"US","usa":"US","us":"US","штаты":"US",

  // Others examples
  "turkey":"TR","турция":"TR",
  "united arab emirates":"AE","оаэ":"AE","uae":"AE",
  "saudi arabia":"SA","саудовская аравия":"SA",
  "brazil":"BR","бразилия":"BR",
  "mexico":"MX","мексика":"MX",
  "india":"IN","индия":"IN",
  "china":"CN","китай":"CN",
  "japan":"JP","япония":"JP",
  "south korea":"KR","корея":"KR","южная корея":"KR",
  "indonesia":"ID","индонезия":"ID",
};

/**
 * Преобразует произвольный ввод (ISO2, пресеты, рус/англ названия)
 * в массив уникальных ISO2-кодов стран (верхний регистр).
 * Примеры ввода: "CIS, US, Италия", "RU, KZ, Ukraine", "EU"
 */
export function normalizeToISO2(input: string): string[] {
  if (!input) return [];
  const parts = input
    .split(/[,\n;]/)
    .map(s => s.trim())
    .filter(Boolean);

  const out = new Set<string>();

  for (const raw of parts) {
    const key = raw.toUpperCase();

    // 1) пресеты (CIS, EU, US, LATAM, MENA, APAC)
    if (REGION_PRESETS[key]) {
      REGION_PRESETS[key].forEach(code => out.add(code));
      continue;
    }

    // 2) ISO2 напрямую (две латинские буквы)
    if (/^[A-Z]{2}$/.test(key)) {
      out.add(key);
      continue;
    }

    // 3) синонимы/локализованные имена
    const low = raw.toLowerCase();
    if (COUNTRY_SYNONYMS[low]) {
      out.add(COUNTRY_SYNONYMS[low]);
      continue;
    }
  }

  return Array.from(out);
}

/**
 * Возвращает true/false — допущен ли пользователь по стране согласно правилам.
 * Если страна неизвестна (undefined) — разрешаем всех, КРОМЕ режима whitelist.
 */
export function isAllowedByGeo(
  countryISO2: string | undefined,
  mode: GeoMode,
  list: string[]
): boolean {
  if (!countryISO2) return mode !== 'whitelist';
  const c = countryISO2.toUpperCase();
  if (mode === 'any') return true;
  const has = list.includes(c);
  return mode === 'whitelist' ? has : !has; // blacklist инвертирует
}
