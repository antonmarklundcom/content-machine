import assert from "node:assert/strict";
import { test } from "node:test";

import { sampleScriptBody } from "@/lib/scripts/fixture";
import { validateScriptBody } from "@/lib/scripts/contract";
import {
  checkListingUrl,
  emptyListing,
  fetchListing,
  finishListingScript,
  LISTING_PHOTO_PREFIX,
  LISTING_SOURCE_ID,
  ListingFetchError,
  normalizeListing,
  parseListingHtml,
} from "./listing";

/** A propia.com.py-shaped page: og: tags plus a RealEstateListing whose offer nests the apartment. */
const PROPIA_HTML = `<!doctype html><html><head>
<title>Depto 2 dormitorios en Villa Morra | Propia</title>
<meta property="og:title" content="Departamento de 2 dormitorios en Villa Morra &amp; piscina">
<meta property="og:description" content='Luminoso, a 3 cuadras del Shopping Villa Morra.'>
<meta property="og:image" content="/fotos/123/1.jpg">
<meta property="og:image" content="https://cdn.propia.com.py/fotos/123/2.jpg">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "name": "Propia", "address": { "@type": "PostalAddress", "streetAddress": "Oficina central 1" } },
    {
      "@type": "RealEstateListing",
      "name": "Depto Villa Morra",
      "image": ["https://cdn.propia.com.py/fotos/123/2.jpg", { "@type": "ImageObject", "contentUrl": "https://cdn.propia.com.py/fotos/123/3.jpg" }],
      "offers": {
        "@type": "Offer",
        "price": 185000,
        "priceCurrency": "USD",
        "seller": { "@type": "RealEstateAgent", "name": "Agente", "address": "No es esta" },
        "itemOffered": {
          "@type": "Apartment",
          "numberOfRooms": 2,
          "numberOfBathroomsTotal": { "@type": "QuantitativeValue", "value": 2 },
          "floorSize": { "@type": "QuantitativeValue", "value": 98, "unitCode": "MTK" },
          "address": { "@type": "PostalAddress", "streetAddress": "Senador Long 1234", "addressLocality": "Asunción", "addressCountry": { "@type": "Country", "name": "Paraguay" } }
        }
      }
    }
  ]
}
</script>
<script type="application/ld+json">{ not json at all </script>
</head><body></body></html>`;

test("a propia-style page: og: title/description, JSON-LD price, address, rooms, area, images", () => {
  const l = parseListingHtml(PROPIA_HTML, "https://propia.com.py/propiedad/depto-villa-morra");
  assert.equal(l.title, "Departamento de 2 dormitorios en Villa Morra & piscina");
  assert.equal(l.description, "Luminoso, a 3 cuadras del Shopping Villa Morra.");
  assert.equal(l.price, "185000");
  assert.equal(l.currency, "USD");
  assert.equal(
    l.address,
    "Senador Long 1234, Asunción, Paraguay",
    "the property's address, not the agency's",
  );
  assert.equal(l.rooms, "2");
  assert.equal(l.bathrooms, "2");
  assert.equal(l.area, "98 m²");
  assert.deepEqual(l.images, [
    "https://propia.com.py/fotos/123/1.jpg",
    "https://cdn.propia.com.py/fotos/123/2.jpg",
    "https://cdn.propia.com.py/fotos/123/3.jpg",
  ]);
  assert.equal(l.url, "https://propia.com.py/propiedad/depto-villa-morra");
});

test("a Product page with an AggregateOffer and a plain-string address", () => {
  const html = `<html><head><title>House &#8211; Luque</title>
  <script type='application/ld+json'>[{"@type":"Product","name":"House in Luque","description":"Three bedrooms, big yard.",
  "image":"https://x.test/a.jpg","offers":{"@type":"AggregateOffer","lowPrice":"950000000","priceCurrency":"PYG"},
  "address":"Luque, Central"}]</script></head></html>`;
  const l = parseListingHtml(html, "https://x.test/house");
  assert.equal(l.title, "House in Luque", "JSON-LD name when there is no og:title");
  assert.equal(l.description, "Three bedrooms, big yard.");
  assert.equal(l.price, "950000000");
  assert.equal(l.currency, "PYG");
  assert.equal(l.address, "Luque, Central");
  assert.deepEqual(l.images, ["https://x.test/a.jpg"]);
});

test("a page with nothing structured falls back to <title> and leaves the rest empty", () => {
  const l = parseListingHtml(
    "<html><head><title> Casa  en venta </title></head></html>",
    "https://y.test/",
  );
  assert.deepEqual({ ...l, url: "" }, { ...emptyListing(), title: "Casa en venta" });
});

test("images: only http(s), deduped, capped at 12", () => {
  const tags = Array.from(
    { length: 20 },
    (_, i) => `<meta property="og:image" content="https://i.test/${i % 15}.jpg">`,
  );
  const html = `<meta property="og:image" content="javascript:alert(1)"><meta property="og:image" content="data:image/png;base64,AA">${tags.join("")}`;
  const l = parseListingHtml(html, "https://i.test/");
  assert.equal(l.images.length, 12);
  assert.ok(l.images.every((u) => u.startsWith("https://i.test/")));
  assert.equal(new Set(l.images).size, 12);
});

test("listing URLs: http(s) on a public host only", () => {
  assert.equal(checkListingUrl("https://propia.com.py/x").hostname, "propia.com.py");
  for (const bad of [
    "ftp://a.test/",
    "not a url",
    "http://localhost:3000/",
    "http://127.0.0.1/",
    "http://192.168.1.4/",
    "http://10.0.0.1/",
    "http://[::1]/",
  ]) {
    assert.throws(() => checkListingUrl(bad), ListingFetchError, bad);
  }
});

test("fetchListing parses the page it gets, and names a timeout as one", async () => {
  const ok = (async () =>
    new Response(PROPIA_HTML, {
      headers: { "content-type": "text/html; charset=utf-8" },
    })) as unknown as typeof fetch;
  const l = await fetchListing("https://propia.com.py/propiedad/1", ok);
  assert.equal(l.currency, "USD");

  const slow = ((_url: URL, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      // AbortSignal.timeout's timer is unref'd; a hanging server holds the loop open.
      const hang = setTimeout(() => {}, 5_000);
      init.signal?.addEventListener("abort", () => {
        clearTimeout(hang);
        reject(init.signal?.reason);
      });
    })) as unknown as typeof fetch;
  await assert.rejects(
    fetchListing("https://propia.com.py/propiedad/1", slow, 20),
    /did not answer within/,
  );

  const pdf = (async () =>
    new Response("%PDF", {
      headers: { "content-type": "application/pdf" },
    })) as unknown as typeof fetch;
  await assert.rejects(fetchListing("https://propia.com.py/a.pdf", pdf), /not a web page/);
  const hops: string[] = [];
  const redirecting = (async (url: URL) => {
    hops.push(url.toString());
    return url.pathname === "/old"
      ? new Response(null, { status: 301, headers: { location: "/propiedad/1" } })
      : new Response(PROPIA_HTML, { headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;
  const moved = await fetchListing("https://propia.com.py/old", redirecting);
  assert.equal(moved.url, "https://propia.com.py/propiedad/1", "the final URL is the listing's");
  assert.deepEqual(hops, ["https://propia.com.py/old", "https://propia.com.py/propiedad/1"]);

  hops.length = 0;
  const intoLan = (async (url: URL) => {
    hops.push(url.toString());
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1:3000/api/media/1/x.png" },
    });
  }) as unknown as typeof fetch;
  await assert.rejects(fetchListing("https://evil.test/", intoLan), /on this computer/);
  assert.deepEqual(hops, ["https://evil.test/"], "the LAN address is never requested");

  const gone = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
  await assert.rejects(fetchListing("https://propia.com.py/gone", gone), /answered 404/);
});

test("normalizeListing trims text and keeps only absolute http(s) images", () => {
  const l = normalizeListing({
    title: "  T ",
    price: 12,
    images: ["https://a.test/1.jpg", "/rel.jpg", "https://a.test/1.jpg", 3],
    url: "nope",
  });
  assert.equal(l.title, "T");
  assert.equal(l.price, "12");
  assert.deepEqual(l.images, ["https://a.test/1.jpg"]);
  assert.equal(l.url, "");
});

function modelBody() {
  const body = sampleScriptBody();
  body.hook.broll = [
    {
      spokenLine: "Look at this light.",
      description: "Living room",
      imagePrompt: "PHOTO P2",
      videoPrompt: null,
      aspectRatio: "16:9",
    },
    {
      spokenLine: "Look at this light.",
      description: "Asunción skyline",
      imagePrompt: "Skyline at dusk",
      videoPrompt: "Slow pan",
      aspectRatio: "16:9",
    },
  ];
  body.sections[0].spokenLines = ["It asks 185,000 USD.", "Two bedrooms."];
  body.sections[0].broll = [
    {
      spokenLine: "Two bedrooms.",
      description: "Bedroom",
      imagePrompt: "PHOTO P9",
      videoPrompt: null,
      aspectRatio: "16:9",
    },
    {
      spokenLine: "Two bedrooms.",
      description: "Street view",
      imagePrompt: "Leafy street",
      videoPrompt: null,
      aspectRatio: "16:9",
    },
  ];
  return body;
}

test("finishListingScript: listing photos first, bad references reassigned, the rest generated, one aspect ratio", () => {
  const listing = {
    ...emptyListing(),
    url: "https://propia.com.py/p/1",
    title: "Depto",
    images: ["https://c.test/1.jpg", "https://c.test/2.jpg", "https://c.test/3.jpg"],
  };
  const body = finishListingScript(modelBody(), listing, "short");

  const shots = [...body.hook.broll, ...body.sections.flatMap((s) => s.broll)];
  assert.deepEqual(
    shots.map((s) => s.imagePrompt),
    [
      `${LISTING_PHOTO_PREFIX}https://c.test/2.jpg`, // the model's pick
      `${LISTING_PHOTO_PREFIX}https://c.test/1.jpg`, // a generated shot takes an unused photo
      `${LISTING_PHOTO_PREFIX}https://c.test/3.jpg`, // P9 does not exist: next free photo
      "Leafy street", // photos used up: Higgsfield
    ],
  );
  assert.equal(
    shots[0].description,
    "Living room",
    "a photo the model chose keeps its description",
  );
  assert.equal(shots[1].description, "Listing photo 1", "a reassigned shot says which photo it is");
  assert.ok(shots.every((s) => s.aspectRatio === "9:16"));

  const listingSource = body.sources.find((s) => s.id === LISTING_SOURCE_ID);
  assert.equal(listingSource?.verifyBeforeRecording, true);
  assert.equal(listingSource?.url, "https://propia.com.py/p/1");
  assert.ok(
    body.sections[0].sourceIds.includes(LISTING_SOURCE_ID),
    "the section stating the price cites the listing",
  );
  assert.deepEqual(validateScriptBody(body), { ok: true });
});

test("finishListingScript without a listing URL: no source to cite, so price sections get a verify note", () => {
  const body = finishListingScript(modelBody(), { ...emptyListing(), title: "By hand" }, "tour");
  assert.ok(!body.sources.some((s) => s.id === LISTING_SOURCE_ID));
  assert.ok(body.sections[0].talkingPoints.some((t) => t.startsWith("VERIFY BEFORE RECORDING")));
  const shots = [...body.hook.broll, ...body.sections.flatMap((s) => s.broll)];
  assert.ok(shots.every((s) => !s.imagePrompt.startsWith("PHOTO ") && s.aspectRatio === "16:9"));
  assert.equal(
    shots[2].imagePrompt,
    "Bedroom",
    "a photo reference with no photos becomes a prompt from its description",
  );
  assert.deepEqual(validateScriptBody(body), { ok: true });
});
