# Order Service creation recovery

Order validates the supplier and Errand fields, then writes an `orderCreation` intent before calling Credit's reservation API. A successful Credit response (or a matching reservation found after a lost response) permits the `OPEN` Errand write. The intent uses the same ObjectId as the Errand; inserting the Errand and marking the intent `COMPLETED` happen in one MongoDB transaction. Credit is not accessed directly through MongoDB.

If the reserve outcome is unknown, Order returns `503 ORDER_CREATION_PENDING` and keeps the intent. If the Errand write fails, Order checks whether that Errand actually committed; it does not refund within the request. Its existing 20-second lifecycle sweep claims the persisted intent before deciding whether to release an orphaned reservation through Credit's internal compensation API. That claim prevents a late Errand transaction from committing after the refund. Initial recovery waits for a 60-second in-flight grace period unless the failed request makes it due immediately; transient failures retry with delays capped at five minutes. `COMPENSATED` means no Errand exists and no reservation remains; `RECONCILE` means an incompatible Credit state needs human review. Do not silently create another order or refund a `RECONCILE` intent. The browser cannot safely infer the result of a timed-out create request, so it should show the pending message and refresh the order list before retrying.

Terminal events still use the existing `eventPending` flag and 20-second publisher relay. A terminal Errand older than two minutes with `eventPending: true` emits a backlog warning. Credit consumes these events with its own retry queue and moves permanent failures to `credit.errand.events.dead`. Inspect both the Order pending intents/events and RabbitMQ's dead-letter count when troubleshooting:

```sh
docker compose exec rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged
```

Dead letters require inspecting the event and the Credit operation log before any replay; a manual replay must preserve its original `eventId` so Credit idempotency still applies. Never purge a queue merely to clear an alert.

## Existing MongoDB volumes

Fresh volumes run `config/db.js` and create the `orderCreation` collection, index, and Order role permission. MongoDB does not rerun that initialization script for existing volumes. Before starting the upgraded Order Service against an existing volume, connect as the MongoDB administrator and run the idempotent migration:

```sh
docker compose exec mongodb mongosh --username admin --authenticationDatabase admin --password
```

At the `mongosh` prompt, enter the administrator password, then:

```javascript
.load("/migrations/order-saga.js")
```

The migration grants Order Service access only to `errands` and `orderCreation` and adds an index for due recovery work. It does not edit existing Errands or Credit balances. Do not use `docker compose down -v` as a substitute: that deletes the project database volume.
