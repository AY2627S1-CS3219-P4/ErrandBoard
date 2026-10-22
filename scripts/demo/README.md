# Isolated saga and outage demo

Run from the repository root with Docker Desktop, Node.js 22+, and OpenSSL:

```sh
bash scripts/demo/saga-demo.sh --help
bash scripts/demo/saga-demo.sh 1
bash scripts/demo/saga-demo.sh orphan-compensation
bash scripts/demo/saga-demo.sh all
```

The script builds and starts a **separate Compose project** with its own MongoDB,
Redis, and RabbitMQ volumes. Its ports are random and bound to loopback. It
generates temporary credentials without reading `.env`, and removes the demo
project and volumes when it exits. Do not run the test against valuable data;
the `all` mode intentionally injects failures and modifies the isolated MongoDB
Order role for scenario 6. A forced shell termination or machine shutdown can
prevent cleanup; inspect `docker compose ls` for `errandboard-demo-*` projects
before removing any residual demo project. Never use `docker compose down -v`
against the normal project as demo cleanup.

Each scenario checks the response and relevant persisted state, not only the
HTTP status. The runner creates unique demo accounts and uses seeded suppliers.

| No. | Scenario | Proof to look for |
| --- | --- | --- |
| 1 | Normal registration | One UserCredit, matching user ID, 100 available and 0 reserved. |
| 2 | Credit unavailable at registration | HTTP 202 and `creditSetupPending`, then one Credit account after recovery. |
| 3 | Ambiguous provisioning reply | Credit applies a provision but its reply is lost; retry still leaves one account and 100/0. |
| 4 | Reservation to completion | One `ORDER_START` reserve and one `ORDER_END` transfer; requester and courier balances settle. |
| 5 | Insufficient balance | HTTP 400; no Errand or Credit log for that attempt. |
| 6 | Reserved funds, failed Errand insert | HTTP 503/pending intent; recovery releases funds, records one refund, and marks intent compensated. |
| 7 | Duplicate reservation | Repeating the internal call applies only once; demo then releases the isolated reservation. |
| 10 | Cancellation versus expiration | A single terminal outcome and one refund. |
| 11 | Two couriers accept | One succeeds, the other conflicts; only the winner is stored. |
| 12 | Completion versus cancellation | Completion succeeds from `PENDING_COMPLETION`, cancellation conflicts, and one transfer occurs. |
| 13 | RabbitMQ outage | Terminal Errand retains `eventPending`; the relay publishes on recovery and Credit refunds once. |
| 14 | Duplicate terminal delivery | RabbitMQ redelivers an identical cancellation event; Credit logs `applied=false` and does not refund again. |
| 15 | Poison event | Invalid event enters the dead-letter queue; no Credit transaction is created. |
| 16 | Service outages | Frontend gateway fails while each backend is stopped, then recovers; User session is still valid after User Service returns. |

Cases 8 and 9 are intentionally omitted. The `all` mode runs the included cases
sequentially against the same isolated stack, but each creates separate users
and orders. Expect scenario 13 to take at least one 20-second Order relay cycle.

This is a deterministic fault-demonstration harness, not a load or security test.
The race cases issue concurrent requests but do not claim to cover every possible
interleaving. Scenario 16 proves gateway and session recovery; it does not render
the browser UI. For the user-facing outage wording, run the existing frontend
outage tests (`cd frontend && npm test`, if dependencies are installed), and
check the pages manually with browser developer tools or the normal stack.
The dead-letter case deliberately leaves its poison event in the isolated queue
for inspection until cleanup; production dead letters require operator review.
