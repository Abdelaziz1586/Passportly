# Travel Planning and Booking Platform

Software Project I, Winter 2026 — German International University (GIU).

## Project Structure

```
.
├── backend/                 # NestJS REST API & MongoDB (Mongoose) schemas
├── frontend/                # Next.js (App Router, TypeScript) frontend (Milestone 2)
├── docs/
│   ├── requirements/        # Official requirements & traceability docs
│   └── api/                 # API documentation & exported specs
├── AI_PROMPTS.txt           # Mandatory AI usage log
├── .env.example             # Environment variable template
├── .gitignore               # Git ignore rules
└── README.md                # Project documentation
```

## Prerequisites

- Node.js >= 20
- npm >= 10
- MongoDB Atlas cluster connection string

## Backend Setup (Milestone 1)

1. Copy `.env.example` to `.env` (or `backend/.env`) and fill in `MONGODB_URI`, `JWT_SECRET`, `STRIPE_SECRET_KEY`, and `FXRATES_API_KEY`.
2. Install dependencies:
   ```bash
   cd backend
   npm install
   ```
3. Place the official reference CSV datasets (`Countries.csv`, `Cities.csv`, `Airports.csv`, `Attractions.csv`) in `backend/data/reference/` and run the seed script (once implemented/configured):
   ```bash
   npm run seed
   ```
4. Start the backend in development mode:
   ```bash
   npm run start:dev
   ```
5. Access Swagger UI documentation at:
   `http://localhost:3000/api/docs`

## Git Workflow

- `main`: Stable milestone/release versions
- `develop`: Integration branch for completed work
- Feature branches: `feature/<REQ-ID>-<description>` from `develop`
