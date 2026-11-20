# Hotels, rooms and reviews (SCRUM-52–SCRUM-69)

This document describes the complete 18-ticket stack. This branch completes SCRUM-52 through SCRUM-58; later ticket routes remain scaffolded here. All PRs target develop and should be merged in ascending ticket order with merge commits to preserve the stack.

These endpoints implement Mohamed Ahmed's 18 hotel tickets for the backend milestone. They use the existing NestJS global JWT/session and role guards, Mongoose models, exception filter, and `/api` prefix. Swagger is served at `/api/docs`.

The [official requirements workbook](https://docs.google.com/spreadsheets/d/17WYE0p9EHUn-GUDrtqtCAekhqecOX8H1/edit) adds acceptance details beyond the ticket screenshots: admin-only hotel creation, unique room names and bed counts, non-overlapping availability initialization, cancellation tiers, combined room occupancy in search, rating-only reviews, and optional moderator replies. The implementation includes those details.

| Ticket | Method and path (after `/api`) | Access |
| --- | --- | --- |
| SCRUM-52 | `POST /hotels` | Admin |
| SCRUM-53 | `GET /hotels/search` | Public |
| SCRUM-54 | `GET /hotels/:id` | Public, active hotels |
| SCRUM-55 | `PATCH /hotels/:id` | Admin or assigned hotel moderator |
| SCRUM-56 | `POST /hotels/:id/rooms` | Admin or assigned hotel moderator |
| SCRUM-57 | `PATCH /hotels/:id/rooms/:roomId` | Admin or assigned hotel moderator |
| SCRUM-58 | `DELETE /hotels/:id/rooms/:roomId` | Admin or assigned hotel moderator |
| SCRUM-59 | `GET /hotels/:id/rooms/available` | Public, active hotels |
| SCRUM-60 | `POST /hotels/:id/rooms/:roomId/availability` | Admin or assigned hotel moderator |
| SCRUM-61 | `PATCH /hotels/:id/rooms/:roomId/availability` | Admin or assigned hotel moderator |
| SCRUM-62 | `GET /hotels/:id/availability` | Public, sanitized calendar |
| SCRUM-63 | `PUT /hotels/:id/policies` | Admin or assigned hotel moderator |
| SCRUM-64 | `GET /hotels/:id/reservations` | Admin or assigned hotel moderator |
| SCRUM-65 | `GET /hotels/:id/reviews` | Public, visible reviews only |
| SCRUM-66 | `POST /hotel-bookings/:id/review` | Registered booking owner |
| SCRUM-67 | `PATCH /reviews/:id` | Registered review author |
| SCRUM-68 | `DELETE /reviews/:id` | Registered review author or admin |
| SCRUM-69 | `POST /reviews/:id/reply` | Admin or moderator assigned to the reviewed hotel |

Two supporting routes satisfy the workbook's media and moderator-calendar requirements:

- `POST /hotels/:id/images` accepts multipart `images` files for the assigned moderator/admin. JPG/PNG content signatures and MIME types must agree, each file is at most 5 MB, and a hotel has at most five photos. Files use generated server filenames and are served from `/uploads`. PATCH `images` can retain, reorder, or remove stored images; disk metadata is verified instead of trusting the client. Arbitrary external URLs are rejected.
- `GET /hotels/:id/availability/management` accepts the same date range as the public calendar and adds private reservation references and allocation counters for the assigned moderator/admin. Public calendar responses never include guest data, reservation references, or maintenance notes.

## Request and response conventions

Dates are real `YYYY-MM-DD` UTC calendar dates. Every range is **start inclusive, end exclusive**, including availability initialization, calendar queries, reservation filters and stays. A range is between 1 and 366 nights. Search and room quotes reject past check-in dates. Missing availability rows mean a room is unavailable; the service never assumes inventory for an uninitialized night.

Identifiers are MongoDB ObjectIds. Hotel city/country selections must reference seeded data, and the country must match the city. The service derives `cityName` and `countryCode`. Invalid IDs yield 400; missing resources yield 404; authorization failures yield 401/403; conflicting inventory or duplicate names/reviews yield 409. DTOs reject unknown fields, invalid numeric bounds, invalid nested values, null required values, and string values masquerading as JSON booleans.

The platform currency is USD, matching the existing schema defaults and the single-currency rule in PAY-04. Room currencies match their hotel. Prices use at most two decimal places. Existing reservation totals and policy snapshots are never rewritten by profile, room-price, availability-price, or policy edits.

Paginated lists return `{ data, total, page, limit, totalPages }`, with page 1 and limit 10 by default (maximum 100). Search defaults to ascending price. Room quotes include every free room, including smaller rooms that may be selected together; `guestCount` is echoed as selection context. Hotel details include paginated active-room and visible-review summaries and an available-room page when both stay dates are supplied.

## Example workflow

Create a hotel as an admin:

```json
{
  "name": "Nile Hotel",
  "address": "12 Nile Street",
  "city": "<seeded-city-object-id>",
  "starRating": 4,
  "amenities": ["wifi", "pool"]
}
```

Create a room as its assigned moderator or admin:

```json
{
  "name": "Room 101",
  "roomType": "Double",
  "numberOfBeds": 2,
  "maxOccupancy": 2,
  "bedConfiguration": "Two single beds",
  "basePricePerNight": 100,
  "totalUnits": 1
}
```

`totalUnits` defaults to 1 for individually bookable rooms. The existing schema also supports a room type with multiple identical units. Room names are unique within a hotel via a compound unique index. Optional adult/child capacities cannot exceed maximum occupancy. Room-price changes apply to future quotes; a nightly override takes precedence until cleared with `priceOverride: null`.

Initialize availability with POST; edit existing nights with PATCH:

```json
{
  "startDate": "2027-01-01",
  "endDate": "2027-01-04",
  "totalUnits": 1,
  "priceOverride": 120,
  "isBlocked": false
}
```

This creates January 1, 2 and 3 at UTC midnight. POST rejects overlaps rather than resetting booked/held counters. Adjacent ranges are allowed. PATCH requires every night to exist, updates the entire range transactionally, and never lowers capacity below booked plus held units. Blocking or zeroing inventory also checks overlapping confirmed reservations and active HELD/PENDING_PAYMENT reservations, including imported bookings whose counters are absent. Any conflict rolls back the entire operation.

Use `/hotels/search?city=<id>&checkInDate=2027-01-01&checkOutDate=2027-01-04&guestCount=4&roomCount=2`. Supply `city`, `country` or a textual `destination` (city/country name or country code). Optional filters are `starRating`, `minRating`, `minPrice`, `maxPrice` and `amenities` (repeated values or comma separated). Supported `sortBy` values are `price`, `rating`, `starRating`, and `name`; `sortOrder` is `asc`/`desc`.

Search requires the requested number of units to remain available for **every** stay night and their combined occupancy to cover the guests. The displayed nightly price is the cheapest room that can participate in a qualifying allocation, averaged over the stay's nightly overrides. Price bounds are inclusive, and a minimum-rating filter excludes unrated hotels. Blocked dates, unavailable nights, inactive rooms/providers, booked units and held units are respected. The search/quote is informational; the separate booking transaction must recheck inventory before holding it.

Available-room responses include `minimumAvailableUnits`, `nights`, `nightlyPrices`, `averagePricePerNight` and `totalStayPrice` for one unit. The stay price sums each stay night exactly once and excludes check-out. Room deletion is rejected while future/current confirmed reservations or active holds exist. A room that was ever reserved is retained and deactivated; a never-reserved room and its calendar rows may be deleted. Deactivation blocks future calendar rows. Reactivation does not silently unblock those rows; explicitly PATCH the intended dates.

## Policies and reviews

PUT policies replaces the policy subdocument. `checkInTime` and `checkOutTime` use 24-hour `HH:mm`. `allowCancellation` and `cancellationTiers` are required. House-rule fields are `childrenAllowed`, `petsAllowed`, `smokingAllowed`, and `termsText`.

```json
{
  "checkInTime": "15:00",
  "checkOutTime": "11:00",
  "allowCancellation": true,
  "cancellationTiers": [
    { "daysBeforeCheckIn": 0, "refundPercentage": 50 },
    { "daysBeforeCheckIn": 3, "refundPercentage": 100 }
  ],
  "childrenAllowed": true,
  "petsAllowed": false,
  "smokingAllowed": false
}
```

Tier thresholds are unique nonnegative integers and refund percentages are 0–100. The booking/refund owner must snapshot these tiers and use the highest threshold not exceeding whole days remaining; if none applies, the refund is zero. Existing legacy fields (`freeCancellationDaysBeforeCheckIn`, `cancellationFeePercentage`, `noShowFeePercentage`) remain supported as metadata; tiers are authoritative for the official tier-based workflow.

Reservation queries accept `status`, `startDate`, `endDate`, pagination, and sorting by `checkInDate`, `checkOutDate`, `createdAt` or `status`. Date filters select overlapping stays, so reservations crossing the start boundary remain included. Guest contact details are available only to staff for that hotel; payment secrets and arbitrary policy snapshot contents are excluded.

Submit a rating with `{ "rating": 5 }` or include optional `title` and `comment` (at most 1000 characters for the comment). A registered traveler must own a CONFIRMED/COMPLETED reservation whose check-out date has passed. A confirmed eligible booking is transitioned to COMPLETED in the review transaction; a minute-based maintenance job also completes checked-out confirmed stays. Unpaid, cancelled, future or other users' bookings are rejected. A unique booking index prevents duplicate concurrent reviews.

Create, update and delete recalculate visible-review counts and ratings in the same transaction. Concurrent changes acquire a hotel write lock before recomputing statistics to prevent lost updates. Public reads calculate statistics from visible reviews, so externally moderated hidden reviews do not leak or inflate displayed ratings. Public reviews are newest first and expose only author display names and reply text/time, not booking IDs, account records or reply author IDs. Deactivated/missing authors appear as `Deleted user`. An admin review deletion is audited within the same transaction. Assigned moderators/admins may set or replace a visible review's embedded `{ replyText, repliedBy, repliedAt }` reply.

## Validation and integration

From `backend/`:

```sh
npm ci
npm run lint
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

The hotel integration suite uses a temporary real MongoDB replica set through the development-only `mongodb-memory-server` dependency and the real JWT/session and role guards. No Atlas configuration or `.env` is read by these tests. The first installation downloads a MongoDB test binary. The suite exercises all 18 endpoints, reference-data validation, public/private responses, uploads, allocation protections, rollback, concurrent initialization and capacity edits, review eligibility, concurrent review uniqueness and aggregate consistency, and revoked/suspended sessions. The health e2e smoke test checks the actual public `/api/health` payload without external services. Swagger generation verifies route and DTO discoverability.

Shared fixes are required for these endpoints: `AppModule` already imported an upload module absent from the repository (the broad `uploads/` ignore pattern also hid source folders), and several dependent schemas declared reference types with `Types.ObjectId` instead of `Schema.Types.ObjectId`. The affected hotel, session, moderator-assignment, city and audit reference paths now cast and query ObjectIds correctly. Existing databases containing legacy **string** references or duplicate room names should be repaired before enabling the new casting/unique index; tests use a fresh isolated database and do not alter team data.

Booking creation/list/detail/cancellation, payment verification, hold expiry/release, provider deactivation, and unrelated team endpoints retain their existing ownership. This ticket set implements their hotel management and review dependencies, not the other developers' pending work. Atlas-backed application startup and external-service integration must still be demonstrated with the team's configured environment.
