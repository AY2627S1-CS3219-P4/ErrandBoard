# CS3219 — Software Design and Architecture (AY2627 Sem 1)

## ErrandBoard (FoC)

**ErrandBoard (FoC)** is a peer-to-peer campus errand platform where students can request items to be collected from stores or facilities on campus, and other students can fulfil (and deliver) those requests. The platform runs on a closed credit economy — credits cannot be bought, withdrawn, or exchanged for money, and only circulate within the platform.

| | |
|---|---|
| **Group** | 04 |
| **Deployment link** | https://da843292oau9i.cloudfront.net |
| **Demo mode** | AWS/local containers |

---

## Team Members

| Name | Role / ownership | N2H feature |
| ----- | ----- | ----- |
| Glen | user service + credit service | Cloud deployment + admin dashboard |
| Jinxia | supplier service + order service | admin dashboard + centralized logging |
| Boqian | supplier service + order service | Real-time status push notifications |
| Joshua | user service + credit service | CI/CD + Cloud deployment |

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

**Tools:** 

- Claude (Anthropic), used through the Claude app / Claude Code. Model version: Sonnet 5.5. Period of use: 2026-09-01 to 2026-11-11.
- Codex (OpenAI), used through ChatGPT app / Codex plugin on VSCode. Models used: GPT-6 Luna (for querying and planning), GPT-6 Sol (for coding/bug fixing)


**AI Usage for:** Boqian
| Area | Mode | What it did | What the author did |
|---|---|---|---|
| Frontend  | generate | Generation UI, service worker, SSE stream client, push subscription helpers, service worker, Home page inbox merge, tests | Review and refactor accordingly |
| Supplier-service | generate / refactor / reference | Generate unit-tests for certain edge cases in supplier-service. Provide refactoring advice for certain implementations in suppler.service. Provide suggestions on integrating authenticate into existing routes. Provided reference for schema entries based on author-design and requirements. | Initial supplier-service design was hand-written with reference to other services. Basic route / service structure was hand-written with refactoring suggestions provided by AI. | 
| Order-service | generate / refactor / reference | Generated template implementation for event implementation. Generated tests for order-service. Provide references / suggestions for correct implementation of user-chosen design. Generated schema reference document based on user chosen requirements. Assistance in refactoring and debugging order-service code base | Initial file structure files were hand-written with reference to other services. Most order routes / services were written with reference to other services with AI assistance and suggestions. Internal logic and state transitions were all author designed.|
| Notification Service | reference/refactor/generate | Generated test code and implementation of Web push + SSE. Service worker in browser was generated. Frontend section for notification service was generated. Initial service setup was reviewed and refactored.| All generated code was reviewed and refactored accordingly. Initial file setup including authentication, routes and folder structure was hand written with reference to other services. |
| CI/CD and AWS deployment (.github/, scripts/, infra/) | generate / debug | Debug errors faced when attempted to modify files for CI/CD + AWS deployment for order + notification services. | Created the AWS resources and applied changes manually. |
| Debugging | debug | Explained errors (VAPID subject, Service Connect timeout, security group, SSE:ERR_HTTP2_PROTOCOL_ERROR, typescript errors) | Applied and verified the fixes |

**AI Usage for:** Joshua
| Area | Mode | What it did | What the author did |
|---|---|---|---|
| Initialising project structure | generate / explain | Generate the initial structure before added work in D2. Explain what each folder is supposed to contain, how they are supposed to interact, explain REST API, explain usage of certain initial libraries | Describe the requirements, query and understand the initial structure, and modify the final architecture based on concepts learned in the course after Microservices topic was taught. |
| User-service | generate / reference | Used to generate ideas for displaying password strength to the user. Used to reference the API URL when linking other components of the project | All decisions about how to sanitise inputs, where to check values as data travels through the system, mode of communication between the services as well as the schema design was done by the Author |
| Credit Service | generate / reference | Generated the code after all decisions were made. Used to visually represents components and interactions to aid diagram drawing in D3 | Decisions on async/sync communication between services, function calling, logging, database transaction, schema design, saga compensation actions etc. was all decided upon by the Author before implementing |
| CI/CD and AWS deployment (.github/, scripts/, infra/) | generate / debug | Debug errors faced when attempted to modify files for CI/CD + AWS deployment (Had issues with authenticating to push images into ECR). Used to generate ideas and check feasibility of deployment decisions such as using EC2 to host database + EBS volumes, or use of AWS Cognito to get registration emails | Created the AWS resources and applied changes manually apart from Cloudfront due to lack of time. Make final decisions based on ideas on how to deploy with the limitations we have (e.g., not allowed to get a domain using Route 53 created issues with using self-signed certs => Use Cloudfront as entry point so that we have a CA-signed cert) |
| Debugging | debug | Spotting and explaining errors as well as suggesting fixes across different services | Applied and verified the fixes |


**AI Usage for:** <insert name>
| Area | Mode | What it did | What the author did |
|---|---|---|---|
