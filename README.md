# CS3219 — Software Design and Architecture (AY2627 Sem 1)

## ErrandBoard (FoC)

**ErrandBoard (FoC)** is a peer-to-peer campus errand platform where students can request items to be collected from stores or facilities on campus, and other students can fulfil (and deliver) those requests. The platform runs on a closed credit economy — credits cannot be bought, withdrawn, or exchanged for money, and only circulate within the platform.

| | |
|---|---|
| **Group** | 04 |
| **Deployment link** | https://da843292oau9i.cloudfront.net |
| **Demo mode** | <AWS | local containers> |

---

## Team Members

| Name | Role / ownership | N2H feature |
| ----- | ----- | ----- |
| Glen | user service + credit service | CI/CD + admin dashboard |
| Jinxia | supplier service + order service | admin dashboard + centralized logging |
| Boqian | supplier service + order service | Real-time status push notifications |
| Joshua | user service + credit service | CI/CD + centralized logging |

---

## Architecture Overview

```text
 Browser (React + Vite, service worker)
        │  HTTPS (nginx / ALB, /api/<service>/*)
        ▼
 ┌────────────┬───────────────┬─────────────┬──────────────┬────────────────────┐
 │ user       │ supplier      │ order       │ credit       │ notification       │
 │ service    │ service       │ service     │ service      │ service            │
 └─────┬──────┴──────┬────────┴──────┬──────┴───────┬──────┴─────────┬──────────┘
       │             │               │  RabbitMQ topic exchange `errand.events`  │
       └─────────────┴──── MongoDB (replica set) ── Redis (authz, BullMQ) ───────┘
```

- **Synchronous:** the frontend calls each service over REST. Order-service calls credit-service (reserve / inspect / release) over HTTP.
- **Asynchronous:** order-service publishes errand events to RabbitMQ (`errand.events`). Credit-service consumes `errand.completed|cancelled|expired` to transfer or refund credits. Notification-service consumes `errand.status.changed` to alert users (SSE + Web Push).
- **Reliability:** transactional outbox in order-service, idempotent consumers keyed by `eventId`, retry queues and dead-letter queues.
- **Order creation** is a saga-style flow with a persisted log (`OrderCreation`) and compensating release of reserved credits; **settlement** is event-driven.

## Tech Stack

| Group | Technologies |
|---|---|
| Frontend | React, Vite, TypeScript, nginx, service worker / PWA manifest |
| Backend | Node.js, Express, TypeScript, Mongoose, JWT (cookies), BullMQ |
| Data | MongoDB (replica set, per-service users, transactions), Redis |
| Messaging / real time | RabbitMQ, Server-Sent Events, Web Push (VAPID) |
| Infra | Docker, Docker Compose, AWS ECS Fargate, ECR, ALB, Service Connect, Secrets Manager, CloudWatch |
| CI/CD | GitHub Actions, GitHub OIDC roles |

---

## Repository Structure

One folder per microservice:

```text
.
├── /services/user-service/
├── /services/supplier-service/
├── /services/order-service/
├── /services/credit-service/
├── /services/notification-service/     # N2H: real-time status notifications
├── frontend/
├── config/                   # MongoDB init + migrations
├── infra/                    # ECS task definitions, IAM policies
├── scripts/                  # deploy / up / down / reset-seed scripts
├── ai/usage-log.md
├── compose.yaml
└── README.md
```

## Service Documentation

Each service documents its own routes, configuration, data model and tests. Start here:

| Component | Documentation |
|---|---|
| User service | [`user-service/README.md`](./services/user-service/README.md) |
| Supplier service | [`supplier-service/README.md`](./services/supplier-service/README.md) |
| Order service | [`order-service/README.md`](./services/order-service/README.md) |
| Credit service | [`credit-service/README.md`](./services/credit-service/README.md) |
| Notification service (N2H) | [`notification-service/README.md`](./services/notification-service/README.md) |
| Frontend | [`frontend/README.md`](./frontend/README.md) |

---

## Running Locally

```bash
cp .env.example .env        # fill in secrets, including VAPID keys for notifications
docker compose up --build
# frontend: http://localhost:5173 (or the port in compose.yaml)
```

Generate VAPID keys once: `npx web-push generate-vapid-keys` (public key to the frontend/service, private key stays server-side).
`<Add seed/reset instructions and demo accounts.>`

## Deployment (AWS)

ECS Fargate cluster `ErrandBoard` (region `ap-southeast-1`), images in ECR, ECS Service Connect for service discovery, secrets in AWS Secrets Manager. GitHub Actions builds, tests and deploys; the `website` workflow brings the stack up or down. See `infra/` and `scripts/`.

## Key Design Decisions

- **Database:** MongoDB per service data with a replica set for transactions (errand creation). Redis for authorization state and BullMQ jobs.
- **Messaging:** RabbitMQ topic exchange so services subscribe independently (credit, notification).
- **Order state machine:** OPEN → ACCEPTED → PICKED_UP → PENDING_COMPLETION → COMPLETED, plus CANCELLED, EXPIRED and DISPUTED; every transition is a guarded atomic update.
- **N2H, notifications:** inbox in MongoDB is the source of truth; SSE for live delivery, Web Push for closed browsers.
- `<Add your own rationale and trade-offs in your own words.>`

## Testing and CI

Unit/integration tests per service (`npm test` in each folder), TypeScript checks, and a GitHub Actions workflow that runs them on every push/PR.

---

## AI Use Summary

(Paste the contents of the AI disclosure section here; it must be the **last section** of this README. Full log: [`ai/usage-log.md`](./ai/usage-log.md).)
