# AGENTS.md — Engineering & Architecture Guide for AI Agents

This repository is the **Travel Planning and Booking Platform (Passportly)** for **Software Project I (Winter 2026)**.
Every AI coding agent (Codex, Antigravity, Cursor, Copilot, etc.) working in this repository **must** follow these rules strictly so you never break existing architecture, security, concurrency, or grading requirements.

---

## 1. Repository Layout & Active Scope

```text
.
├── backend/                          # NestJS 11 + Mongoose 9 + Swagger REST API (Milestone 1 active)
│   ├── data/reference/               # Official reference CSVs (Countries, Cities, Airports, Attractions)
│   └── src/
│       ├── main.ts                   # Global /api prefix, Swagger (/api/docs), ValidationPipe, CORS, cookies, rawBody
│       ├── app.module.ts             # ConfigModule, ScheduleModule, DatabaseModule, global JwtAuthGuard & RolesGuard
│       ├── app.controller.ts         # GET /api/health (@Public)
│       ├── config/                   # configuration.ts, env.validation.ts
│       ├── common/                   # enums, decorators, guards, filters, dto, interfaces, schemas
│       ├── database/                 # database.module.ts, seed.ts (npm run seed)
│       └── modules/                  # Feature modules (controllers, services, schemas, dto/)
│           ├── auth/                 # JWT httpOnly cookie auth, JwtStrategy, UserSession
│           ├── users/                # User profile, ModeratorAssignment
│           ├── admin/                # Admin moderation, accounts, providers, bookings, audit logs
│           ├── reference-data/       # Country, City, Airport, Attraction (read-only public endpoints)
│           ├── flights/              # Airline, Flight, CabinInventory, FlightBooking
│           ├── hotels/               # Hotel, Room, RoomAvailability, HotelBooking, Review
│           ├── payments/             # Payment, Refund, Stripe test mode & webhooks
│           ├── itineraries/          # Itinerary (+ ItineraryDay), Activity, BudgetEntry, TransportCost, ExchangeRate
│           ├── blog/                 # BlogPost, Comment, Like, Tag
│           ├── notifications/        # @Global() NotificationsService + Notification schema/controller
│           ├── reports/              # Content reporting (POST /api/reports)
│           ├── audit-logs/           # @Global() AuditLogsService + AuditLog schema
│           └── uploads/              # @Global() UploadsService (image MIME/size validation & disk storage)
├── frontend/                         # Milestone 2 (Next.js App Router + TypeScript) — do NOT build unless asked
├── docs/
│   ├── requirements/
│   │   ├── jira-endpoints-import.csv # Jira CSV import source for all 126 endpoints
│   │   └── endpoint-assignments.md   # SCRUM-7..SCRUM-132 ownership mapping across 7 developers
│   └── api/
├── AI_PROMPTS.txt                    # Mandatory AI prompt log (Section 11.1)
├── .env.example                      # Required env vars template (NEVER commit .env)
└── README.md
```

---

## 2. Hard Rules (Never Violate These)

### 2.1 Security & Secrets
- **NEVER** read, log, hardcode, or commit `.env`, `backend/.env`, `MONGODB_URI`, `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, or `FXRATES_API_KEY`.
- **NEVER** expose `passwordHash`, `emailVerificationToken`, `passwordResetToken`, `passwordResetExpiresAt`, or `stripeClientSecret` in API responses.
- **NEVER** store raw credit card numbers, CVVs, or card details in any schema or log.
- **NEVER** accept `role` or `status` from public registration (`POST /api/auth/register` must always create `Role.REGISTERED_USER` with `AccountStatus.ACTIVE`). Administrator self-registration is strictly forbidden.
- **NEVER** store auth tokens in browser `localStorage`/`sessionStorage`; auth uses **httpOnly cookies** (`cookie-parser` + `JwtStrategy`).

### 2.2 Global Guards, Decorators & Routing
- `JwtAuthGuard` and `RolesGuard` are registered **globally** via `APP_GUARD` in `backend/src/app.module.ts`.
  - Every endpoint requires a valid, unrevoked session cookie and `AccountStatus.ACTIVE` **unless** decorated with `@Public()` (`backend/src/common/decorators/public.decorator.ts`).
  - Use `@Roles(...roles)` (`backend/src/common/decorators/roles.decorator.ts`) with `Role` from `backend/src/common/enums/index.ts`.
  - Access the authenticated user with `@CurrentUser()` (`backend/src/common/decorators/current-user.decorator.ts`), typed as `AuthenticatedUser` (`userId`, `email`, `role`, `jti`, `assignedProviderId?`, `assignedProviderType?`).
- **Global Prefix `/api`:** `app.setGlobalPrefix('api')` is already configured in `backend/src/main.ts`.
  - **NEVER** prefix `@Controller('api/...')`. Use `@Controller('flights')`, `@Controller('posts')`, `@Controller()`, etc.
- **Static vs Parameterized Routes:** Keep static routes (`search`, `mine`, `hold`, `read-all`, `public/search`, `webhook`) declared **above** `:id` routes in every controller so Express does not match `"search"` or `"mine"` as `:id`.

### 2.3 Validation & Error Handling
- `main.ts` enables `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } })`.
  - **Every** field in a DTO must have `class-validator` decorators (`@IsString()`, `@IsOptional()`, `@IsMongoId()`, etc.) AND `@ApiProperty()` / `@ApiPropertyOptional()` for Swagger. Any undecorated property in a request body/query will be stripped or rejected with `400 Bad Request` (`forbidNonWhitelisted: true`).
  - Use `PaginationQueryDto` (`backend/src/common/dto/pagination-query.dto.ts`) as the base class or pattern for paginated list/search endpoints.
- `AllExceptionsFilter` (`backend/src/common/filters/http-exception.filter.ts`) formats all exceptions uniformly. Throw NestJS `HttpException` subclasses (`BadRequestException`, `UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `ConflictException`).
- Always validate MongoDB ObjectIds (`isValidObjectId` / `@IsMongoId()`) before querying by ID so invalid IDs return `400`/`404` cleanly instead of `500 CastError`.

### 2.4 Ownership & Provider Scoping (Critical!)
`RolesGuard` checks **only** the user's `Role`. Services **must** enforce ownership:
- **Travelers (`Role.REGISTERED_USER`):** Verify ownership (`doc.user.toString() === user.userId` or `doc.author.toString() === user.userId`) on all private bookings, itineraries, activities, budgets, transport costs, posts (drafts/edits/deletes), comments, reviews, notifications, payments, and refunds.
- **Moderators (`Role.AIRLINE_MODERATOR`, `Role.HOTEL_MODERATOR`):** A moderator can manage **exactly one** assigned provider (`user.assignedProviderId` loaded by `JwtStrategy` from `ModeratorAssignment`). Always verify `providerId === user.assignedProviderId` (unless `user.role === Role.ADMIN`).
- **Private vs Public Resources:** Never leak `PRIVATE` itineraries or `DRAFT` blog posts (or `isHidden: true` moderated items) to other users or guests.

### 2.5 Concurrency, Holds & Transactions
- **Flight Seat Holds (`POST /api/flight-bookings/hold`):** Must be concurrency-safe. Atomically decrement `CabinInventory.availableSeats` and increment `heldSeats` using a conditional filter (`availableSeats: { $gte: seatsRequired }`) inside a Mongoose transaction/atomic update so concurrent requests can never oversell capacity.
- **Hotel Multi-Room Bookings (`POST /api/hotel-bookings`):** Must run inside a Mongoose `ClientSession` transaction (`session.withTransaction(...)`). For **every** selected room and **every** stay night (normalized to **UTC midnight** `YYYY-MM-DDT00:00:00.000Z`), atomically verify `isBlocked: false` and `bookedUnits + heldUnits + quantity <= totalUnits` before incrementing `heldUnits`. If any room or night fails, the entire multi-room booking rolls back.
- **Hold Expiry:** Use `@Cron` (`@nestjs/schedule` is already imported in `AppModule`) to expire stale `HELD` / `PENDING_PAYMENT` bookings whose `holdExpiresAt <= now`, releasing `heldSeats` / `heldUnits`, setting booking status to `BookingStatus.EXPIRED`, and creating an in-app notification (`NotificationType.BOOKING_HOLD_EXPIRED`).

### 2.6 Payments, Policies & Refunds (Stripe Test Mode)
- Policy acceptance (`POST /api/bookings/:type/:id/accept-policies`) **must** be recorded with `policyAcceptedAt` and `policyAcceptedBy` **before** creating a payment.
- **NEVER** mark a `FlightBooking` or `HotelBooking` as `CONFIRMED` before verified Stripe payment completion.
- `POST /api/payments/webhook` (`@Public()`) must verify the `stripe-signature` header using `req.rawBody` (`rawBody: true` is enabled in `main.ts`) and `configService.get('stripe.webhookSecret')` via `stripe.webhooks.constructEvent(...)`.
- Webhook handlers **must be idempotent** (do not double-confirm bookings, double-deduct inventory, or send duplicate notifications on Stripe retries).
- Refunds must compute refund amounts from the **booking's stored `policySnapshot`** (not mutable live provider policies that may have changed after booking).

### 2.7 Time Zones, Currencies & External APIs
- **Airports & Flights:** Store `Flight.departureTime` and `Flight.arrivalTime` in UTC `Date`. Use the departure/arrival airport's IANA `timezone` (`Airport.timezone`, seeded from `Airports.csv`) when filtering by local departure date or formatting e-ticket/search times.
- **Supported Currencies:** Validate currencies against seeded `Country.currencyCode` records (`Countries.csv`).
- **FXRatesAPI:** Integrate strictly on the backend (`ItinerariesService`), caching rates in `ExchangeRate` (`expiresAt`) and never exposing `FXRATES_API_KEY`. Handle invalid currency codes, missing rates, and external HTTP failures with clean `400`/`503` responses.

### 2.8 Notifications, Audit Logs & Provider Deactivation
- Inject global `NotificationsService.createNotification(...)` for booking confirmations/cancellations/hold-expiry, payment success/failure, refunds, flight schedule changes/cancellations, account suspension/reactivation, provider deactivation/reactivation, and moderation actions.
- Inject global `AuditLogsService.log(...)` for all admin actions (`MODERATOR_CREATED`, `ACCOUNT_SUSPENDED`, `ACCOUNT_REACTIVATED`, `PROVIDER_DEACTIVATED`, `PROVIDER_REACTIVATED`, `REPORT_RESOLVED`, `CONTENT_DELETED`, `ADMIN_PASSWORD_RESET`).
- **Deactivating a Provider (`Airline.isActive = false` / `Hotel.isActive = false`):** Separate from suspending its moderator account. Deactivated providers are hidden from public search and blocked from new bookings, while existing `CONFIRMED` bookings remain valid and affected parties receive in-app notifications.

---

## 3. Reuse Existing Schemas & Shared Services (Do Not Duplicate)

All Mongoose schemas already exist and are registered in their feature modules. **Do not create duplicate models or collections.**

| Domain | Existing Schemas | Existing Module / Service |
|---|---|---|
| Auth / Sessions | `UserSession` | `backend/src/modules/auth/` (`AuthService`) |
| Users / Moderators | `User`, `ModeratorAssignment` | `backend/src/modules/users/` (`UsersService`) |
| Reference Data | `Country`, `City`, `Airport`, `Attraction` | `backend/src/modules/reference-data/` (`ReferenceDataService`) |
| Flights | `Airline`, `Flight`, `CabinInventory`, `FlightBooking` | `backend/src/modules/flights/` (`FlightsService`) |
| Hotels & Reviews | `Hotel`, `Room`, `RoomAvailability`, `HotelBooking`, `Review` | `backend/src/modules/hotels/` (`HotelsService`) |
| Payments & Refunds | `Payment`, `Refund` | `backend/src/modules/payments/` (`PaymentsService`) |
| Itineraries | `Itinerary` (+ `ItineraryDay`), `Activity`, `BudgetEntry`, `TransportCost`, `ExchangeRate` | `backend/src/modules/itineraries/` (`ItinerariesService`) |
| Blog & Community | `BlogPost`, `Comment`, `Like`, `Tag` | `backend/src/modules/blog/` (`BlogService`) |
| Notifications | `Notification` | `backend/src/modules/notifications/` (`NotificationsService`, `@Global`) |
| Reports | `Report` | `backend/src/modules/reports/` (`ReportsService`) |
| Audit Logs | `AuditLog` | `backend/src/modules/audit-logs/` (`AuditLogsService`, `@Global`) |
| Media Uploads | `MediaItem` (`common/schemas/media-item.schema.ts`) | `backend/src/modules/uploads/` (`UploadsService`, `@Global`) |

All enums live in `backend/src/common/enums/index.ts`. Always import from there rather than redefining string literals.

---

## 4. Team Ownership & Minimal-Conflict Boundaries

Before editing a controller or service outside your assigned ticket, check `docs/requirements/endpoint-assignments.md`:
- `SCRUM-7` – `SCRUM-21`: **Abdelaziz Mohamed** (`auth`, `users`, `reference-data`)
- `SCRUM-22` – `SCRUM-37`: **Youssef Sherif** (`admin`, `reports`, `notifications`)
- `SCRUM-38` – `SCRUM-51`: **Mohamed Fady** (`airlines.controller.ts`, `flights.controller.ts`)
- `SCRUM-52` – `SCRUM-69`: **Mohamed Ahmed** (`hotels.controller.ts`, review routes in `hotel-bookings.controller.ts`)
- `SCRUM-70` – `SCRUM-88`: **Abdelrahman Ahmed** (`flight-bookings.controller.ts`, booking routes in `hotel-bookings.controller.ts`, `payments.controller.ts`)
- `SCRUM-89` – `SCRUM-116`: **Ahmed Amer** (`itineraries.controller.ts`)
- `SCRUM-117` – `SCRUM-132`: **Abdullah Emam** (`blog.controller.ts`)

If you need cross-module service methods (e.g., `PaymentsService` confirming a `FlightBooking` or `ItinerariesService` reusing hotel/flight search), import the exported module cleanly rather than injecting foreign Mongoose models directly where a clean service helper belongs, and avoid circular module dependencies (`forwardRef` only as a last resort).

---

## 5. TypeScript, ESLint & Build Verification

- `backend/tsconfig.json` uses `"module": "nodenext"` and `"strictNullChecks": true`.
- ESLint enforces `@typescript-eslint` type-checked rules (`no-unsafe-assignment`, `no-unsafe-member-access`, etc.). Avoid `any`; type Express requests, Mongoose lean objects, and error catches explicitly.
- **Before finishing any ticket or opening a PR**, run from `backend/`:
  ```bash
  npm run lint
  npm run build
  npm test
  ```
- Verify your endpoints in Swagger UI at `http://localhost:3000/api/docs` (`npm run start:dev`).

---

## 6. Git, Jira Automation & AI Log Workflow

1. **Never work on `main`.** Always branch from updated `develop`:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/SCRUM-<N>-<REQ-ID>-<short-description>
   ```
2. **Include `SCRUM-<N>`** in your branch name and PR title so the connected GitHub-to-Jira automation transitions your ticket (`To Do` → `In Progress` on branch create, `In Review` on PR open, `Done` on merge).
3. Use Conventional Commits: `feat(flights): implement search (SCRUM-44, FLT-11)`.
4. **Update `AI_PROMPTS.txt`** whenever AI materially contributed to a task, using the exact Section 11.1 format (`Date`, `Student`, `Tool`, `Related Requirement`, `Prompt`, `How the output was used`).
