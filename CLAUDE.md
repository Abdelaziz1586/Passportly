# CLAUDE.md — Project Instructions for Claude Code & AI Assistants

You are working on **Passportly** (Travel Planning and Booking Platform — GIU Software Project I, Winter 2026).
Read this entire file before editing any code. It defines the exact architecture, security invariants, schemas, and verification steps so changes integrate cleanly without breaking teammates' work.

---

## 1. Tech Stack & Commands

- **Backend (`backend/`):** NestJS 11 (`@nestjs/common ^11`), Mongoose 9 (`@nestjs/mongoose`), MongoDB Atlas (`passportly` DB), Swagger (`@nestjs/swagger`), `class-validator`, `class-transformer`, `passport-jwt`, `bcryptjs`, `cookie-parser`, `@nestjs/schedule`, `stripe` (test mode), `@nestjs/axios` (FXRatesAPI).
- **Frontend (`frontend/`):** Reserved for Milestone 2 (Next.js App Router + TypeScript). Do **not** scaffold or modify `frontend/` during Milestone 1 unless explicitly requested.

### Essential Commands (run inside `backend/`)
```bash
npm run start:dev   # Start NestJS API + Swagger UI at http://localhost:3000/api/docs
npm run seed        # Seed default ADMIN user + reference CSVs from backend/data/reference/
npm run lint        # ESLint with --fix (strict @typescript-eslint type-checked rules)
npm run build       # TypeScript / NestJS build check
npm test            # Jest unit tests
```

---

## 2. Project Structure & Where Things Live

```text
backend/src/
├── main.ts                     # Global prefix /api, Swagger /api/docs, ValidationPipe, cookieParser, CORS, rawBody: true
├── app.module.ts               # ConfigModule (global), ScheduleModule, DatabaseModule, global JwtAuthGuard + RolesGuard
├── app.controller.ts           # GET /api/health (@Public)
├── config/
│   ├── configuration.ts        # Typed config keys: port, frontendUrl, mongodbUri, jwt.*, seedAdmin.*, stripe.*, fxRates.*, uploads.*
│   └── env.validation.ts
├── common/
│   ├── enums/index.ts          # ALL domain enums (Role, AccountStatus, BookingStatus, PaymentStatus, etc.)
│   ├── decorators/             # @Public(), @Roles(...), @CurrentUser()
│   ├── guards/                 # JwtAuthGuard, RolesGuard
│   ├── filters/                # AllExceptionsFilter
│   ├── dto/                    # PaginationQueryDto
│   ├── interfaces/             # JwtPayload, AuthenticatedUser
│   └── schemas/                # MediaItem (embedded subdocument for images)
├── database/
│   ├── database.module.ts
│   └── seed.ts
└── modules/
    ├── auth/                   # AuthController, AuthService, JwtStrategy, UserSession schema
    ├── users/                  # UsersController, UsersService, User & ModeratorAssignment schemas
    ├── admin/                  # AdminController, AdminService
    ├── reference-data/         # ReferenceDataController/Service + Country, City, Airport, Attraction schemas
    ├── flights/                # AirlinesController, FlightsController, FlightBookingsController, FlightsService + schemas
    ├── hotels/                 # HotelsController, HotelBookingsController, HotelsService + schemas
    ├── payments/               # PaymentsController, PaymentsService + Payment & Refund schemas
    ├── itineraries/            # ItinerariesController, ItinerariesService + Itinerary, Activity, BudgetEntry, TransportCost, ExchangeRate
    ├── blog/                   # BlogController, BlogService + BlogPost, Comment, Like, Tag schemas
    ├── notifications/          # @Global() NotificationsModule/Service + Notification schema
    ├── reports/                # ReportsController, ReportsService + Report schema
    ├── audit-logs/             # @Global() AuditLogsModule/Service + AuditLog schema
    └── uploads/                # @Global() UploadsModule/Service (image validation & disk persistence)
```

---

## 3. Architecture & Security Invariants (Never Violate)

### 3.1 Auth, Guards & Cookies
1. **Global Guards:** `JwtAuthGuard` and `RolesGuard` are bound globally in `backend/src/app.module.ts`.
   - Routes require authentication by default. Only mark intentionally public endpoints with `@Public()`.
   - Restrict endpoints by role using `@Roles(Role.ADMIN, ...)`.
   - Extract the caller using `@CurrentUser() user: AuthenticatedUser`.
2. **httpOnly Cookies:** `JwtStrategy` (`backend/src/modules/auth/strategies/jwt.strategy.ts`) reads the JWT from the `httpOnly` cookie (`jwt.cookieName`, default `access_token`) with a Bearer fallback for Swagger testing.
   - `login` must create a `UserSession` (`jti`, `expiresAt`) and set an `httpOnly` cookie (`sameSite: 'lax'`, `secure: configService.get('jwt.cookieSecure')`).
   - `logout` must set `UserSession.revokedAt = new Date()` and clear the cookie.
   - `register` (`POST /api/auth/register`) must **always** assign `Role.REGISTERED_USER` and `AccountStatus.ACTIVE`. Never allow admin self-registration or privilege escalation via request body.
3. **Mandatory Service-Level Ownership Checks:**
   - `RolesGuard` does **not** verify resource ownership. Always verify ownership inside your service:
     - **Users:** `doc.user.toString() === currentUser.userId` (or `doc.author`, `doc.recipient`, etc.).
     - **Moderators:** `JwtStrategy` populates `currentUser.assignedProviderId` and `currentUser.assignedProviderType` from `ModeratorAssignment`. Moderators can manage **only** their single assigned airline or hotel (`providerId === currentUser.assignedProviderId`).

### 3.2 DTOs, Routing & Error Responses
- **Do NOT put `api/` in `@Controller()`:** `app.setGlobalPrefix('api')` is already set in `main.ts`.
- **Keep static routes above `:id` routes:** Never move `/search`, `/mine`, `/hold`, `/read-all`, `/public/search`, or `/webhook` below `:id` routes.
- **DTOs are mandatory for every input:** `ValidationPipe` runs with `whitelist: true` and `forbidNonWhitelisted: true`. Every body, query, and param DTO property must have `class-validator` decorators AND `@ApiProperty()` / `@ApiPropertyOptional()`.
- **Consistent Errors:** Throw standard NestJS exceptions (`BadRequestException`, `UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `ConflictException`) so `AllExceptionsFilter` formats responses uniformly. Validate MongoDB ObjectIds before querying (`isValidObjectId`).

### 3.3 Booking Concurrency, Holds & Stripe Payments
- **Flight Holds (`POST /api/flight-bookings/hold`):** Use atomic conditional updates (`availableSeats: { $gte: seatsRequired }`) or Mongoose transactions on `CabinInventory` (`availableSeats` down, `heldSeats` up) so concurrent requests cannot oversell seats.
- **Hotel Multi-Room Bookings (`POST /api/hotel-bookings`):** Wrap all selected rooms and all stay nights (normalized to **UTC midnight**) in a **Mongoose transaction** (`session.withTransaction(...)`) checking `isBlocked: false` and `bookedUnits + heldUnits + qty <= totalUnits` on `RoomAvailability`. If any room or night is unavailable, abort the whole reservation.
- **Hold Expiry Cron:** Use `@Cron` (`@nestjs/schedule`) to expire `HELD`/`PENDING_PAYMENT` bookings when `holdExpiresAt <= now`, releasing `heldSeats`/`heldUnits` and sending `NotificationType.BOOKING_HOLD_EXPIRED`.
- **Stripe Test Mode & Webhooks (`PAY-01`, `PAY-02`, `PAY-03`):**
  - Require recorded `policyAcceptedAt` before creating a Stripe `PaymentIntent`.
  - Never confirm a booking before verified Stripe payment completion.
  - `POST /api/payments/webhook` must verify `stripe-signature` using `req.rawBody` (`rawBody: true` is configured in `main.ts`) and `STRIPE_WEBHOOK_SECRET`, and handle `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, and `charge.refunded` **idempotently**.
  - Never store raw card information.
  - Calculate cancellation refunds from the booking's `policySnapshot` recorded at booking time.

### 3.4 Time Zones, Currencies, Notifications & Audit Logs
- Store flight `departureTime` / `arrivalTime` in UTC `Date`, and use `Airport.timezone` (IANA time zone from `Airports.csv`) for local-date filtering and e-ticket display.
- Validate currencies against seeded `Country.currencyCode` records (`Countries.csv`).
- Call **FXRatesAPI** strictly from `ItinerariesService` (using `ExchangeRate` caching and `FXRATES_API_KEY` from config); handle invalid currencies and upstream failures cleanly.
- Use global `NotificationsService.createNotification(...)` for bookings, payments, refunds, flight schedule changes/cancellations, provider/account status changes, and moderation actions.
- Use global `AuditLogsService.log(...)` for all administrative & moderation actions.
- Deactivating an airline or hotel (`isActive = false`) hides it from search and blocks new bookings while keeping existing `CONFIRMED` bookings valid and notifying affected users/moderators.

---

## 4. Existing Schemas & Team Boundaries

All Mongoose schemas are already implemented and registered. **Reuse them — do not duplicate schemas or enums.**
- Enums: `backend/src/common/enums/index.ts`
- Embedded media subdocument: `backend/src/common/schemas/media-item.schema.ts` + `UploadsService.saveImage()`
- Module schemas live under `backend/src/modules/<module>/schemas/`

### 7-Person Task Ownership (see `docs/requirements/endpoint-assignments.md`)
- `SCRUM-7` – `SCRUM-21`: **Abdelaziz Mohamed** (`auth`, `users`, `reference-data`)
- `SCRUM-22` – `SCRUM-37`: **Youssef Sherif** (`admin`, `reports`, `notifications`)
- `SCRUM-38` – `SCRUM-51`: **Mohamed Fady** (`airlines`, `flights`)
- `SCRUM-52` – `SCRUM-69`: **Mohamed Ahmed** (`hotels`, `reviews`)
- `SCRUM-70` – `SCRUM-88`: **Abdelrahman Ahmed** (`flight-bookings`, `hotel-bookings`, `payments`)
- `SCRUM-89` – `SCRUM-116`: **Ahmed Amer** (`itineraries`)
- `SCRUM-117` – `SCRUM-132`: **Abdullah Emam** (`blog`)

Only edit files owned by the current ticket/module unless a small shared export in another module's service is needed (and keep module imports clean with no circular dependencies).

---

## 5. TypeScript, ESLint & Done Checklist

1. Respect `"module": "nodenext"`, `"strictNullChecks": true`, and strict `@typescript-eslint` rules (no `any`, no unsafe member access/assignments).
2. Add/update DTOs (`class-validator` + `@ApiProperty`), controller Swagger annotations, service logic, and tests.
3. Run all checks inside `backend/` before committing:
   ```bash
   npm run lint && npm run build && npm test
   ```
4. **Git & Jira Workflow:**
   - Never commit `.env` or secrets.
   - Never work on `main`. Branch from `develop`: `git checkout -b feature/SCRUM-<N>-<REQ-ID>-<description>`.
   - Include `SCRUM-<N>` in the branch name and PR title so Jira automation transitions the ticket (`To Do` → `In Progress` → `In Review` → `Done`).
5. **AI Prompt Log:** Append material prompts used to `AI_PROMPTS.txt` following the Section 11.1 template.
