/**
 * Known geography words. A company rule must never take one of these for an
 * employer: "Marketing Manager, Berlin" names a city, not a company.
 * All entries are lowercase ASCII.
 */

const COUNTRIES = [
  "argentina", "australia", "austria", "bangladesh", "belgium", "brazil", "bulgaria", "canada", "chile",
  "china", "colombia", "costa rica", "croatia", "cyprus", "czech republic", "czechia", "denmark",
  "dominican republic", "ecuador", "egypt", "england", "estonia", "ethiopia", "finland", "france",
  "germany", "ghana", "great britain", "greece", "hong kong", "hungary", "iceland", "india", "indonesia",
  "ireland", "israel", "italy", "japan", "jordan", "kazakhstan", "kenya", "latvia", "lithuania",
  "luxembourg", "malaysia", "mexico", "morocco", "netherlands", "new zealand", "nigeria", "northern ireland",
  "norway", "pakistan", "panama", "peru", "philippines", "poland", "portugal", "puerto rico", "qatar",
  "romania", "russia", "saudi arabia", "scotland", "serbia", "singapore", "slovakia", "slovenia",
  "south africa", "south korea", "spain", "sweden", "switzerland", "taiwan", "thailand", "tunisia",
  "turkey", "ukraine", "united arab emirates", "united kingdom", "united states", "uruguay", "usa",
  "u.s.a.", "uae", "uk", "u.k.", "us", "u.s.", "venezuela", "vietnam", "wales", "america", "korea",
];

const CITIES = [
  "abu dhabi", "amsterdam", "athens", "atlanta", "austin", "bangalore", "bangkok", "barcelona", "beijing",
  "bengaluru", "berlin", "bogota", "boston", "brisbane", "brooklyn", "brussels", "bucharest", "budapest",
  "buenos aires", "calgary", "cape town", "chennai", "chicago", "cologne", "copenhagen", "dallas",
  "delhi", "denver", "detroit", "dublin", "dubai", "frankfurt", "geneva", "hamburg", "helsinki",
  "houston", "hyderabad", "istanbul", "jakarta", "johannesburg", "kuala lumpur", "lagos", "lima",
  "lisbon", "london", "los angeles", "lyon", "madrid", "manila", "melbourne", "mexico city", "miami",
  "milan", "montreal", "moscow", "mumbai", "munich", "nairobi", "new delhi", "new york", "nyc", "oslo",
  "osaka", "ottawa", "paris", "perth", "philadelphia", "phoenix", "pittsburgh", "porto", "portland",
  "prague", "pune", "riyadh", "rio de janeiro", "rome", "rotterdam", "san diego", "san francisco",
  "san jose", "sao paulo", "seattle", "seoul", "shanghai", "shenzhen", "singapore", "sofia", "stockholm",
  "stuttgart", "sydney", "taipei", "tel aviv", "tokyo", "toronto", "vancouver", "vienna", "warsaw",
  "washington", "washington dc", "zurich", "hong kong",
];

const US_STATE_NAMES = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware",
  "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky",
  "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri",
  "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico", "north carolina",
  "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina",
  "south dakota", "tennessee", "texas", "utah", "vermont", "virginia", "west virginia", "wisconsin", "wyoming",
];

/** Two-letter US state codes, checked whole-string and case-insensitively. */
const US_STATE_CODES = [
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il", "in", "ia", "ks", "ky",
  "la", "me", "md", "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd",
  "oh", "ok", "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy", "dc",
];

const REGIONS = [
  "africa", "americas", "american", "apac", "apj", "asia", "asia pacific", "asia-pacific", "benelux",
  "dach", "emea", "eu", "europe", "eastern europe", "western europe", "global", "international",
  "latam", "latin america", "mena", "middle east", "nordic", "nordics", "north america", "oceania",
  "scandinavia", "south america", "uk and ireland", "anywhere", "hybrid", "on-site", "onsite",
  "remote", "worldwide", "world", "multiple locations", "various locations", "various", "wfh",
];

const GEOGRAPHY = new Set<string>([
  ...COUNTRIES,
  ...CITIES,
  ...US_STATE_NAMES,
  ...US_STATE_CODES,
  ...REGIONS,
]);

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** True when the text is exactly a known country, city, US state, or region. */
export function isGeographyTerm(text: string): boolean {
  return GEOGRAPHY.has(normalize(text));
}

/**
 * Every lowercase term a profile's own location (or the search location)
 * names: the whole phrase, each comma-separated part, and each word of two or
 * more characters. "Austin, Texas, United States" yields "austin", "texas",
 * "united", "states" and the full phrases.
 */
export function locationTerms(location: string | null | undefined): Set<string> {
  const terms = new Set<string>();
  const whole = normalize(location ?? "");
  if (!whole) return terms;
  terms.add(whole);
  for (const part of whole.split(/\s*[,;/|]\s*/)) {
    const clean = part.trim();
    if (!clean) continue;
    terms.add(clean);
    for (const word of clean.split(/[\s()-]+/)) {
      if (word.length >= 2) terms.add(word);
    }
  }
  return terms;
}
