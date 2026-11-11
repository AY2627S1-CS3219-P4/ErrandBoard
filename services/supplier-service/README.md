# Supplier Service

Maintains the stores, facilities and landmarks (for example CoffeeBean@Com3, Printers@PCCommons) from which requesters can request errands. It supports CRUD for admins and search/filtering for everyone, and is the data source for the supplier-listing page. Default port: **3002**.


## Responsibilities
- Store supplier data (name, category, building, address, coordinates, opening hours, image, description).
- Public, filterable listing and lookup for requesters and couriers.
- Admin-only create, update and soft-delete (deactivate).
- Seed the initial supplier data from the template CSV.

## Tech
Node.js, Express 5, TypeScript, Mongoose (MongoDB), Redis (authorization state), `jose` (JWT verification), `csv-parse` (seeding).

## API

Base path: `/suppliers` (the frontend reaches it through the gateway/proxy path for the supplier service).

| Method | Route | Access | Description |
|---|---|---|---|
| GET | `/suppliers` | Public (admin sees more) | List suppliers with search and filters |
| GET | `/suppliers/:id` | Public (admin sees inactive) | Get one supplier |
| POST | `/suppliers` | Admin | Create a supplier (`201`) |
| PATCH | `/suppliers/:id` | Admin | Update fields (validated) |
| DELETE | `/suppliers/:id` | Admin | Soft delete: sets `isActive: false` |
| GET | `/health` | Public | Liveness check |

### Listing, search and filtering
`GET /suppliers` query parameters (all optional, combinable):

| Param | Behaviour |
|---|---|
| `search` | Case-insensitive partial match on the supplier name (input is regex-escaped) |
| `category` | One or more categories (repeat the param); matches any |
| `building` | One or more buildings; matches any |
| `address` | One or more addresses; matches any |
| `showInactive=true` | Admins only: include deactivated suppliers (ignored for other users) |

Results are sorted by name (ascending) and returned as `{ "suppliers": [...] }`. Inactive suppliers are hidden from non-admins, and `GET /suppliers/:id` returns `404` for them.

### Errors
`404` supplier not found · `409` duplicate supplier (same name + building) · `401` authentication required, expired or revoked token · `403` insufficient role or inactive account · `503 AUTHORIZATION_UNAVAILABLE` when Redis is unreachable (fails closed).

## Data model (`suppliers` collection)

| Field | Notes |
|---|---|
| `name` | required, 1–100 chars |
| `category` | `FOOD_BEVERAGE`, `RETAIL`, `CONVENIENCE`, `PRINTING`, `OTHER` |
| `building`, `address` | required, 1–100 chars |
| `locationDescription` | optional, up to 100 chars |
| `coordinates` | optional `{ latitude, longitude }` |
| `openingHours` | optional; per day (`mon`…`sun`) a list of `{ open, close }` in `HH:mm`; an empty list means closed |
| `imageUrl`, `description` | optional (description up to 500 chars) |
| `isActive` | default `true`; used for soft deletes |
| `createdAt`, `updatedAt` | automatic timestamps |

Indexes: a **unique** index on `(name, building)` to prevent duplicates, and a text index on `name`.

### Design notes
- **Soft delete** keeps references from existing errands valid and allows admins to review or reinstate suppliers.
- **Search with `$regex` on a small collection** gives partial-substring matching, which the text index alone does not.
- **Multi-select filters** use `$in`, so filters combine with AND across fields and OR within a field.

## Authorization
Protected requests verify the access JWT, then read the user's current authorization version, role and active status from Redis. A stale token is rejected even before its 15-minute expiry. Redis misses and connection errors return `503 AUTHORIZATION_UNAVAILABLE` and do not grant access. Public supplier listings remain accessible without a token; if a valid token is supplied for admin-only listing behaviour, its live authorization is checked too.

The local Compose stack provides `REDIS_URL`. An AWS deployment should point it to the same private, managed Redis-compatible service used by User Service, with TLS and access controls. Supplier Service only reads authorization state and never changes roles or versions.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3002` | HTTP port |
| `MONGO_HOST`, `MONGO_DB_NAME` | `127.0.0.1`, `errandboard` | MongoDB location |
| `MONGO_SUPPLIER_SERVICE_PASSWORD` | none | Password of the service's least-privilege Mongo user |
| `JWT_SECRET` | none | Verifies access tokens (`<confirm name>`) |
| `REDIS_URL` | none | Authorization state |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS origin (credentials enabled) |
| `SEED_CSV_PATH` | `../../data/csv/supplier-seed-data.csv` | Seed file |

## Run, seed and test
```bash
npm install
npm run dev            # tsx watch
npm run build && npm start
npm run seed:dev       # seed from the CSV (dev); `npm run seed` after a build
npm test               # unit tests (node --test)
npm run typecheck
npm run test:integration
```
The seed maps CSV types to categories (`Food`, `Food/Coffee` → `FOOD_BEVERAGE`, `Shopping` → `RETAIL`, `Printing` → `PRINTING`).

## Tests
Model, service, controller, route and authorization-state tests live in `tests/`.

## Integration
- **Frontend:** the supplier-listing page uses the list endpoint; the errand form selects a supplier.
- **Order service:** reads supplier information when an errand is created (`supplier.client`).
- **User service:** shares JWT and Redis authorization state.
