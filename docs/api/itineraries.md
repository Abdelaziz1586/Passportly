# Itinerary planning API

All paths below use the global `/api` prefix. Swagger is served at `/api/docs`.
Protected routes use the existing httpOnly session cookie. Mutations require
`REGISTERED_USER` and service-level ownership checks. Admins may read private
itinerary details; they do not gain write access to another user's itinerary.

## Endpoints and Jira traceability

| Jira | Method | Path | Behavior |
| --- | --- | --- | --- |
| SCRUM-89 | POST | `/itineraries` | Create a private itinerary |
| SCRUM-90 | GET | `/itineraries` | Paginated owner list |
| SCRUM-91 | GET | `/itineraries/:id` | Owner/admin details with ordered children |
| SCRUM-92 | PATCH | `/itineraries/:id` | Metadata, start date, currency, visibility |
| SCRUM-93 | DELETE | `/itineraries/:id` | Delete itinerary and child records in a transaction |
| SCRUM-94 | POST | `/itineraries/:id/days` | Append a day with a derived date |
| SCRUM-95 | PATCH | `/itineraries/:id/days/:dayId` | Edit city, title and notes |
| SCRUM-96 | DELETE | `/itineraries/:id/days/:dayId` | Delete children and renumber dates in a transaction |
| SCRUM-97 | PATCH | `/itineraries/:id/days/reorder` | Validate a full day-ID permutation and update dates |
| SCRUM-98 | POST | `/itineraries/:id/days/:dayId/activities` | Add an activity, optionally linked to an attraction |
| SCRUM-99 | PATCH | `/activities/:id` | Edit an activity and validate its time range |
| SCRUM-100 | DELETE | `/activities/:id` | Delete an owned activity |
| SCRUM-101 | POST | `/activities/:id/images` | Multipart image upload (`file`) |
| SCRUM-102 | DELETE | `/activities/:id/images/:imageId` | Remove an owned activity image |
| SCRUM-103 | POST | `/itineraries/:id/days/:dayId/budgets` | Add a categorized budget entry |
| SCRUM-104 | PATCH | `/budgets/:id` | Edit an owned budget entry |
| SCRUM-105 | DELETE | `/budgets/:id` | Delete an owned budget entry |
| SCRUM-106 | POST | `/itineraries/:id/transport-costs` | Add an intercity transport cost |
| SCRUM-107 | PATCH | `/transport-costs/:id` | Edit an owned transport cost |
| SCRUM-108 | DELETE | `/transport-costs/:id` | Delete an owned transport cost |
| SCRUM-109 | GET | `/itineraries/:id/budget-summary` | Owner/public budget conversion and category totals |
| SCRUM-110 | GET | `/itineraries/public/search` | Public, unhidden itinerary search |
| SCRUM-111 | GET | `/itineraries/public/:id` | Public details with author attribution |
| SCRUM-112 | POST | `/itineraries/:id/clone` | Deep-copy a public itinerary into a private itinerary |
| SCRUM-113 | GET | `/itineraries/:id/hotels` | Available hotels for each contiguous city stay |
| SCRUM-114 | GET | `/itineraries/:id/flights` | Flight suggestions for city transitions |
| SCRUM-115 | POST | `/itineraries/:id/bookings` | Attach an owned, confirmed flight/hotel booking |
| SCRUM-116 | GET | `/itineraries/:id/pdf` | Owner/public PDF download |

The public search and public details routes permit guests. Budget summaries and
PDFs authenticate a session when provided and permit guest access only to
`PUBLIC`, unhidden itineraries. Private or hidden resources return 404 to guests
and other users. Owners retain access to their own records.

## Request examples

Create an itinerary:

```json
{
  "title": "Summer trip",
  "startDate": "2027-06-15",
  "displayCurrency": "EUR"
}
```

`countries` optionally accepts unique MongoDB country IDs from reference data.
Currency codes must exist in seeded countries; unseeded currency data does not
implicitly authorize arbitrary codes. Day dates are derived in UTC, with day 1
on the itinerary start date. Editing the start date, deleting a day or reordering
days recalculates numbering and dates. Concurrent itinerary edits return 409
when a stale version would overwrite a newer edit.

Reorder days (every day ID must appear exactly once):

```json
{
  "dayIds": ["673c1f2a9c4b2d001f8a1235", "673c1f2a9c4b2d001f8a1234"]
}
```

Attach a booking:

```json
{
  "bookingType": "FLIGHT",
  "bookingId": "673c1f2a9c4b2d001f8a1234"
}
```

Booking attachment accepts only owned `CONFIRMED` bookings and does not change
payment, booking status or inventory. Cloning does not copy booking attachments.
Cloned day/child/image IDs and local image files are independent of the source.

## Queries and integrations

- Owner lists: `page`, `limit`, `search`, `visibility`, `sortBy`, `sortOrder`.
- Public search: `page`, `limit`, `search`, `countryId`, `minDays`, `maxDays`,
  `sortBy`, `sortOrder`. Private and hidden itineraries are always excluded.
- Sort fields: `createdAt`, `updatedAt`, `startDate`, `title`, `cloneCount`.
- Budget summary: optional `currency`, defaulting to `displayCurrency`.
- Hotel/flight context: optional inclusive `startDay` and `endDay` numbers.

Budget entries and transport costs retain their original amount and currency.
Summaries convert using unexpired cached exchange rates; missing rates are
requested from FXRatesAPI with a 10-second timeout and cached for 60 seconds.
Malformed rates and unavailable upstream configuration/network return 503;
unsupported currency input returns 400. No provider credentials are returned.
The request parameters follow the [FXRatesAPI documentation](https://fxratesapi.com/docs).

Hotel suggestions group consecutive days in the same city, including every stay
night and a checkout on the following day. At least one active room must have a
free unit on every night. Blocked/missing/sold-out nights exclude that room.
Inactive hotels are excluded. The response has `itineraryId`, `cityIds` and
`stays`, with matching `hotels` inside each stay.

Flight transitions use the next city's itinerary day as the local departure
date. Airport IANA timezones determine the UTC search window. Cancelled flights
and inactive airlines are excluded. Search results are suggestions; availability
must still be checked by the booking workflow.

Uploads accept JPEG, PNG, GIF and WebP. The multipart parser enforces the
configured maximum size, and storage validates MIME type, signature and buffer
size. PDF export streams `application/pdf` with days, activities, budget entries
and intercity transport costs.

## Verification

Run `npm run lint`, `npm run build` and `npm test` from `backend/`.
`itineraries.integration.spec.ts` starts an isolated local MongoDB replica set,
uses real models and HTTP requests, and tears down the database and temporary
upload directory. It never loads application environment files or connects to
the configured application database. Its authentication identities are test
fixtures; separate guard tests cover protected/public/optional authentication.
On the first install, mongodb-memory-server downloads its MongoDB test binary.
