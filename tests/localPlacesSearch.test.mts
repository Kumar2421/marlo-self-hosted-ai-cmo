import test from "node:test";
import assert from "node:assert/strict";
import { PLACES_FIELD_MASK, PlacesApiError, searchPlacesPage } from "../lib/domain/leads/local/placesSearch.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("searchPlacesPage sends the key in a header, the field mask, and pageSize 20", async () => {
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(url);
    seenInit = init;
    return jsonResponse(200, { places: [] });
  }) as typeof fetch;

  await searchPlacesPage(fakeFetch, "KEY-123", { category: "Plumber", location: "Austin" });

  assert.equal(seenUrl, "https://places.googleapis.com/v1/places:searchText");
  const headers = seenInit?.headers as Record<string, string>;
  assert.equal(headers["X-Goog-Api-Key"], "KEY-123");
  assert.equal(headers["X-Goog-FieldMask"], PLACES_FIELD_MASK);
  const body = JSON.parse(String(seenInit?.body));
  assert.equal(body.textQuery, "Plumber in Austin");
  assert.equal(body.pageSize, 20);
  assert.equal(body.pageToken, undefined);
});

test("field mask lists nextPageToken unprefixed and never asks for editorialSummary", () => {
  const fields = PLACES_FIELD_MASK.split(",");
  assert.ok(fields.includes("nextPageToken"));
  assert.ok(!fields.includes("places.nextPageToken"));
  assert.ok(!PLACES_FIELD_MASK.includes("editorialSummary"));
});

test("searchPlacesPage maps fields, skips closed businesses and missing ids, and returns the next token", async () => {
  const fakeFetch = (async () =>
    jsonResponse(200, {
      places: [
        {
          id: "p1",
          displayName: { text: "Acme Plumbing" },
          formattedAddress: "1 Main St",
          nationalPhoneNumber: "(512) 555-0100",
          websiteUri: "https://acme.example.org",
          rating: 4.7,
          userRatingCount: 212,
          businessStatus: "OPERATIONAL",
          primaryTypeDisplayName: { text: "Plumber" },
          googleMapsUri: "https://maps.example/p1",
        },
        { id: "p2", displayName: { text: "Gone" }, businessStatus: "CLOSED_PERMANENTLY" },
        { id: "p3", displayName: { text: "Shut" }, businessStatus: "CLOSED_TEMPORARILY" },
        { displayName: { text: "No id" } },
        { id: "p4" },
      ],
      nextPageToken: "TOKEN-2",
    })) as typeof fetch;

  const page = await searchPlacesPage(fakeFetch, "k", { category: "Plumber", location: "Austin" });

  assert.deepEqual(page.places.map((p) => p.id), ["p1", "p4"]);
  assert.deepEqual(page.places[0], {
    id: "p1",
    name: "Acme Plumbing",
    address: "1 Main St",
    phone: "(512) 555-0100",
    website: "https://acme.example.org",
    rating: 4.7,
    reviewCount: 212,
    businessStatus: "OPERATIONAL",
    primaryType: "Plumber",
    mapsUrl: "https://maps.example/p1",
  });
  assert.equal(page.places[1].name, "(unnamed)");
  assert.equal(page.nextPageToken, "TOKEN-2");
});

test("searchPlacesPage sends pageToken on later pages and returns null when there are no more", async () => {
  let body: Record<string, unknown> = {};
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return jsonResponse(200, { places: [] });
  }) as typeof fetch;
  const page = await searchPlacesPage(fakeFetch, "k", { category: "Plumber", location: "Austin", pageToken: "T1", regionCode: "US" });
  assert.equal(body.pageToken, "T1");
  assert.equal(body.regionCode, "US");
  assert.equal(page.nextPageToken, null);
});

test("searchPlacesPage maps HTTP errors to helpful messages without echoing the key or body", async () => {
  const cases: [number, RegExp, number][] = [
    [403, /Places API \(New\)/, 403],
    [400, /rejected/, 400],
    [429, /quota/, 429],
    [500, /HTTP 500/, 502],
  ];
  for (const [status, pattern, httpStatus] of cases) {
    const fakeFetch = (async () => new Response("secret-key-echo SECRET-KEY-XYZ", { status })) as typeof fetch;
    await assert.rejects(
      () => searchPlacesPage(fakeFetch, "SECRET-KEY-XYZ", { category: "x", location: "y" }),
      (err: unknown) => {
        assert.ok(err instanceof PlacesApiError);
        assert.equal(err.httpStatus, httpStatus);
        assert.match(err.message, pattern);
        assert.ok(!err.message.includes("SECRET-KEY-XYZ"));
        assert.ok(!err.message.includes("secret-key-echo"));
        return true;
      }
    );
  }
});

test("searchPlacesPage turns a network failure into a generic 502 error", async () => {
  const fakeFetch = (async () => {
    throw new Error("socket hang up for SECRET-KEY-XYZ");
  }) as typeof fetch;
  await assert.rejects(
    () => searchPlacesPage(fakeFetch, "SECRET-KEY-XYZ", { category: "x", location: "y" }),
    (err: unknown) => err instanceof PlacesApiError && err.httpStatus === 502 && !err.message.includes("SECRET")
  );
});
