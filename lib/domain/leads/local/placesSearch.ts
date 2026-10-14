/**
 * Google Places API (New) text search, one page at a time. Pure apart from the injected fetch:
 * the key is only ever sent in the X-Goog-Api-Key header and never appears in an error message.
 */

export type LocalPlace = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  businessStatus: string | null;
  primaryType: string | null;
  mapsUrl: string | null;
};

export type PlacesPageResult = { places: LocalPlace[]; nextPageToken: string | null };

export type PlacesSearchInput = {
  category: string;
  location: string;
  pageToken?: string;
  regionCode?: string;
};

export class PlacesApiError extends Error {
  readonly httpStatus: number;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.name = "PlacesApiError";
    this.httpStatus = httpStatus;
  }
}

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
export const PLACES_PAGE_SIZE = 20;
const TIMEOUT_MS = 15_000;
const CLOSED_STATUSES = new Set(["CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"]);

// Places API (New) needs an explicit field mask. nextPageToken is a top-level response field,
// so it is listed without the "places." prefix. Enterprise and Pro tier fields are included on
// purpose (rating, phone, website, status); editorialSummary is deliberately NOT requested.
export const PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
  "places.primaryTypeDisplayName",
  "places.googleMapsUri",
  "nextPageToken",
].join(",");

function errorFor(status: number): PlacesApiError {
  if (status === 403) {
    return new PlacesApiError(
      "Google refused the Places request. Enable Places API (New) on this Google Cloud project and check the key's API restrictions.",
      403
    );
  }
  if (status === 400) {
    return new PlacesApiError("Google rejected the Places search. Try a more specific category or location.", 400);
  }
  if (status === 429) {
    return new PlacesApiError("Google Places quota is used up for now. Try again later.", 429);
  }
  return new PlacesApiError(`Google Places search failed (HTTP ${status}).`, 502);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

type RawPlace = {
  id?: unknown;
  displayName?: { text?: unknown };
  formattedAddress?: unknown;
  nationalPhoneNumber?: unknown;
  internationalPhoneNumber?: unknown;
  websiteUri?: unknown;
  rating?: unknown;
  userRatingCount?: unknown;
  businessStatus?: unknown;
  primaryTypeDisplayName?: { text?: unknown };
  googleMapsUri?: unknown;
};

export function toLocalPlace(raw: RawPlace): LocalPlace | null {
  const id = str(raw.id);
  if (!id) return null;
  return {
    id,
    name: str(raw.displayName?.text) ?? "(unnamed)",
    address: str(raw.formattedAddress),
    phone: str(raw.nationalPhoneNumber) ?? str(raw.internationalPhoneNumber),
    website: str(raw.websiteUri),
    rating: num(raw.rating),
    reviewCount: num(raw.userRatingCount),
    businessStatus: str(raw.businessStatus),
    primaryType: str(raw.primaryTypeDisplayName?.text),
    mapsUrl: str(raw.googleMapsUri),
  };
}

/**
 * One page of up to PLACES_PAGE_SIZE results. Closed businesses are dropped here so no caller
 * has to remember to. Pass the returned nextPageToken back with the SAME category and location:
 * Google rejects a page request whose other parameters differ from the first request.
 */
export async function searchPlacesPage(
  fetchImpl: typeof fetch,
  apiKey: string,
  input: PlacesSearchInput
): Promise<PlacesPageResult> {
  const textQuery = `${input.category.trim()} in ${input.location.trim()}`;
  const body: Record<string, unknown> = { textQuery, pageSize: PLACES_PAGE_SIZE };
  if (input.pageToken) body.pageToken = input.pageToken;
  if (input.regionCode) body.regionCode = input.regionCode;

  let res: Response;
  try {
    res = await fetchImpl(PLACES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": PLACES_FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new PlacesApiError("Couldn't reach Google Places. Try again.", 502);
  }

  if (!res.ok) {
    try {
      await res.body?.cancel();
    } catch {
      // ignore
    }
    throw errorFor(res.status);
  }

  const data = (await res.json().catch(() => ({}))) as { places?: RawPlace[]; nextPageToken?: unknown };
  const places: LocalPlace[] = [];
  for (const raw of Array.isArray(data.places) ? data.places : []) {
    const place = toLocalPlace(raw);
    if (!place) continue;
    if (place.businessStatus && CLOSED_STATUSES.has(place.businessStatus)) continue;
    places.push(place);
  }
  return { places, nextPageToken: str(data.nextPageToken) };
}
