import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cases = new Map([
  ["1", ["registration", "Normal registration and allocation", normalRegistration]],
  ["2", ["provisioning-outage", "Credit unavailable during registration", provisioningOutage]],
  ["3", ["ambiguous-provisioning", "Provisioning succeeded but response was lost", ambiguousProvisioning]],
  ["4", ["completion", "Reservation, completion, and transfer", completion]],
  ["5", ["insufficient-credit", "Insufficient balance creates no Errand", insufficientCredit]],
  ["6", ["orphan-compensation", "Reserved credit with failed Errand insert", orphanCompensation]],
  ["7", ["duplicate-reservation", "Duplicate reservation is idempotent", duplicateReservation]],
  ["10", ["cancel-expiry-race", "Cancellation versus expiration", cancelExpiryRace]],
  ["11", ["competing-couriers", "Two couriers accept concurrently", competingCouriers]],
  ["12", ["completion-cancel-conflict", "Completion versus cancellation", completionCancelConflict]],
  ["13", ["rabbit-outage", "RabbitMQ outage and pending-event relay", rabbitOutage]],
  ["14", ["duplicate-terminal-event", "Duplicate terminal event delivery", duplicateTerminalEvent]],
  ["15", ["dead-letter", "Poison event reaches the dead-letter queue", deadLetter]],
  ["16", ["service-outages", "Service outages and recovery", serviceOutages]],
]);

function help() {
  console.log("Usage: scripts/demo/saga-demo.sh all|<number>|<name>");
  for (const [number, [name, title]] of cases) console.log(`  ${number.padStart(2)}  ${name.padEnd(27)} ${title}`);
  console.log("  8, 9  excluded by request");
}

function compose(args, { timeout = 60_000 } = {}) {
  const result = spawnSync("docker", ["compose", "--project-name", process.env.DEMO_PROJECT,
    "--env-file", "/dev/null", "-f", resolve(root, "compose.yaml"),
    "-f", resolve(root, "compose.demo.yaml"), ...args], {
    cwd: root, env: process.env, encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Docker Compose ${args[0]} failed: ${(result.stderr || result.error?.message || "unknown error").trim()}`);
  }
  return result.stdout.trim();
}

function port(service, target) {
  const output = compose(["port", service, String(target)]);
  const match = /:(\d+)$/.exec(output);
  if (!match) throw new Error(`Could not determine the demo port for ${service}`);
  return `http://127.0.0.1:${match[1]}`;
}

function id(value) {
  assert.match(value, /^[a-f\d]{24}$/i, "expected a MongoDB ObjectId");
  return value;
}

function mongo(expression) {
  const script = `const d = db.getSiblingDB("errandboard"); print(EJSON.stringify(${expression}));`;
  const output = compose(["exec", "-T", "mongodb", "mongosh",
    "mongodb://127.0.0.1:27017/admin?directConnection=true", "--username", "admin",
    "--password", process.env.MONGO_ROOT_PASSWORD, "--authenticationDatabase", "admin",
    "--quiet", "--eval", script]);
  const line = output.split("\n").filter(Boolean).at(-1);
  if (!line) throw new Error("MongoDB returned no assertion result");
  try { return JSON.parse(line); } catch { throw new Error(`MongoDB returned an unexpected result: ${line.slice(0, 120)}`); }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(label, check, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) { lastError = error; }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

let bases;
let supplierId;
let sequence = 0;
const emailSeed = 1_000_000 + randomInt(7_000_000);

async function request(service, path, { method = "GET", body, actor, headers = {}, timeout = 12_000 } = {}) {
  const url = `${bases[service]}${path}`;
  let response;
  try { response = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(actor ? { Cookie: Object.entries(actor.cookies).map(([key, value]) => `${key}=${value}`).join("; ") } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeout),
  }); } catch (error) {
    throw new Error(`${service} ${method} ${path}: ${error.cause?.code ?? error.message}`, { cause: error });
  }
  if (actor) {
    for (const cookie of response.headers.getSetCookie()) {
      const match = /^([^=;]+)=([^;]*)/.exec(cookie);
      if (match) actor.cookies[match[1]] = match[2];
    }
  }
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: response.status, data, text };
}

function expectStatus(response, status, label) {
  assert.equal(response.status, status, `${label}: ${response.data?.code ?? response.data?.error ?? "unexpected response"}`);
}

async function register({ expectedStatus = 201 } = {}) {
  const n = emailSeed + sequence++;
  const username = `demo_${n}`;
  const password = `${randomBytes(20).toString("base64url")}Ab3!`;
  const response = await request("user", "/auth/register", {
    method: "POST", body: { email: `e${n}@u.nus.edu`, username, password },
  });
  expectStatus(response, expectedStatus, "register");
  const userId = id(response.data?.user?.id);
  return { id: userId, username, password, cookies: {} };
}

async function login(actor) {
  const response = await request("user", "/auth/login", {
    method: "POST", body: { username: actor.username, password: actor.password }, actor,
  });
  expectStatus(response, 200, "login");
  assert.equal(response.data?.user?.id, actor.id);
  assert.ok(actor.cookies.access_token && actor.cookies.session_token, "login cookies were not set");
  return actor;
}

async function actor() {
  const person = await register();
  await login(person);
  await balanceIs(person.id, 100, 0);
  return person;
}

function userDoc(userId) {
  return mongo(`d.users.findOne({_id:ObjectId("${id(userId)}")},{creditSetupPending:1,creditSetupAttempts:1,username:1})`);
}

function creditDoc(userId) {
  return mongo(`d.UserCredits.findOne({userId:ObjectId("${id(userId)}")},{available:1,reserve:1,isActive:1,userId:1})`);
}

function creditCount(userId) {
  return mongo(`d.UserCredits.countDocuments({userId:ObjectId("${id(userId)}")})`);
}

function errandDoc(orderId) {
  return mongo(`d.errands.findOne({_id:ObjectId("${id(orderId)}")},{status:1,requesterId:1,courierId:1,eventPending:1,updatedAt:1,credit:1})`);
}

function creationDoc(orderId) {
  return mongo(`d.orderCreation.findOne({_id:ObjectId("${id(orderId)}")},{state:1,retryAttempts:1,requesterId:1})`);
}

function logCount(orderId, type) {
  return mongo(`d.transactionLog.countDocuments({orderId:ObjectId("${id(orderId)}"),transactionType:"${type}"})`);
}

function logDoc(orderId, type) {
  return mongo(`d.transactionLog.findOne({orderId:ObjectId("${id(orderId)}"),transactionType:"${type}"},{action:1,requesterId:1,courierId:1,amount:1})`);
}

async function balanceIs(userId, available, reserve) {
  return until(`balance ${available}/${reserve}`, () => {
    const doc = creditDoc(userId);
    return doc?.available === available && doc?.reserve === reserve ? doc : false;
  });
}

async function fault(mode = "none", method = "", path = "", count = 0) {
  const response = await request("proxy", "/__demo/fault", {
    method: "POST", headers: { "x-demo-control-token": process.env.DEMO_CONTROL_TOKEN },
    body: { mode, method, path, count },
  });
  expectStatus(response, 200, "arm demo fault");
}

async function createOrder(requester, amount = 10) {
  const response = await request("order", "/errands", {
    method: "POST", actor: requester,
    body: { supplierId, dropoff: "Demo lobby", description: "Isolated saga demo", credit: amount },
  });
  expectStatus(response, 201, "create Errand");
  const orderId = id(response.data?.errand?._id);
  assert.equal(errandDoc(orderId)?.status, "OPEN");
  assert.equal(logCount(orderId, "ORDER_START"), 1);
  return orderId;
}

async function transition(person, orderId, action, expected = 200) {
  const response = await request("order", `/errands/${id(orderId)}/${action}`, { method: "POST", actor: person });
  expectStatus(response, expected, `${action} Errand`);
  return response;
}

async function normalRegistration() {
  const person = await actor();
  assert.equal(userDoc(person.id)?.creditSetupPending, false);
  assert.equal(creditCount(person.id), 1);
  assert.equal(creditDoc(person.id)?.userId?.$oid, person.id);
}

async function provisioningOutage() {
  await fault("fail", "PUT", "/credit/accounts/*", -1);
  try {
    const person = await register({ expectedStatus: 202 });
    assert.equal(userDoc(person.id)?.creditSetupPending, true);
    assert.equal(creditCount(person.id), 0);
    await fault();
    await until("one-time Credit provisioning after recovery", () =>
      userDoc(person.id)?.creditSetupPending === false && creditCount(person.id) === 1 &&
      creditDoc(person.id)?.available === 100, 90_000);
    assert.equal(creditDoc(person.id)?.reserve, 0);
  } finally { await fault(); }
}

async function ambiguousProvisioning() {
  await fault("drop-after", "PUT", "/credit/accounts/*", 1);
  try {
    const person = await register({ expectedStatus: 202 });
    assert.equal(creditCount(person.id), 1, "Credit applied the request before its response was lost");
    await until("registration reconciliation", () => userDoc(person.id)?.creditSetupPending === false);
    assert.equal(creditCount(person.id), 1);
    assert.deepEqual([creditDoc(person.id)?.available, creditDoc(person.id)?.reserve], [100, 0]);
  } finally { await fault(); }
}

async function completion() {
  const requester = await actor();
  const courier = await actor();
  const orderId = await createOrder(requester, 10);
  await balanceIs(requester.id, 90, 10);
  await transition(courier, orderId, "accept");
  await transition(courier, orderId, "pickup");
  await transition(courier, orderId, "deliver");
  await transition(requester, orderId, "complete");
  await balanceIs(requester.id, 90, 0);
  await balanceIs(courier.id, 110, 0);
  assert.equal(errandDoc(orderId)?.status, "COMPLETED");
  assert.equal(logCount(orderId, "ORDER_END"), 1);
  assert.equal(logDoc(orderId, "ORDER_END")?.action, "TRANSFER");
}

async function insufficientCredit() {
  const requester = await actor();
  const before = mongo(`d.errands.countDocuments({requesterId:"${id(requester.id)}"})`);
  const response = await request("order", "/errands", {
    method: "POST", actor: requester,
    body: { supplierId, dropoff: "Demo lobby", description: "Too expensive", credit: 101 },
  });
  assert.equal(response.data?.code, "INSUFFICIENT_CREDITS");
  assert.equal(response.status, 400);
  assert.equal(mongo(`d.errands.countDocuments({requesterId:"${id(requester.id)}"})`), before);
  assert.equal(mongo(`d.transactionLog.countDocuments({requesterId:ObjectId("${id(requester.id)}")})`), 0);
  assert.deepEqual([creditDoc(requester.id)?.available, creditDoc(requester.id)?.reserve], [100, 0]);
}

async function orphanCompensation() {
  const requester = await actor();
  const before = mongo(`d.orderCreation.countDocuments({requesterId:"${id(requester.id)}"})`);
  const role = mongo(`d.getRole("order_service_role", {showPrivileges:true})`);
  assert.ok(role?.privileges?.length, "Order role not found");
  const original = role.privileges.map(({ resource, actions }) => ({ resource, actions }));
  const restricted = original.map((entry) => entry.resource.collection === "errands"
    ? { ...entry, actions: entry.actions.filter((action) => action !== "insert") } : entry);
  assert.notDeepEqual(restricted, original, "Order role has no Errand insert privilege to fault");
  mongo(`d.updateRole("order_service_role", {privileges:${JSON.stringify(restricted)}})`);
  let response;
  try {
    response = await request("order", "/errands", {
      method: "POST", actor: requester,
      body: { supplierId, dropoff: "Demo lobby", description: "Errand write failure", credit: 10 },
    });
    assert.equal(response.status, 503);
    assert.equal(response.data?.code, "ORDER_CREATION_PENDING");
  } finally {
    mongo(`d.updateRole("order_service_role", {privileges:${JSON.stringify(original)}})`);
  }
  await until("Order intent", () => mongo(`d.orderCreation.countDocuments({requesterId:"${id(requester.id)}"})`) > before);
  const creation = mongo(`d.orderCreation.findOne({requesterId:"${id(requester.id)}"},{_id:1},{sort:{createdAt:-1}})`);
  const orderId = id(creation?._id?.$oid);
  await until("compensated orphan", () => creationDoc(orderId)?.state === "COMPENSATED", 120_000);
  assert.equal(errandDoc(orderId), null);
  await balanceIs(requester.id, 100, 0);
  assert.equal(logCount(orderId, "ORDER_START"), 1);
  assert.equal(logCount(orderId, "ORDER_END"), 1);
  assert.equal(logDoc(orderId, "ORDER_END")?.action, "REFUND");
}

async function duplicateReservation() {
  const requester = await actor();
  const orderId = randomBytes(12).toString("hex");
  const headers = { Authorization: `Bearer ${process.env.ORDER_CREDIT_API_KEY}` };
  const body = { orderId, requesterId: requester.id, amount: 10 };
  const first = await request("credit", "/credit/reservations", { method: "POST", headers, body });
  const second = await request("credit", "/credit/reservations", { method: "POST", headers, body });
  expectStatus(first, 200, "first reservation");
  expectStatus(second, 200, "repeated reservation");
  assert.equal(first.data?.applied, true);
  assert.equal(second.data?.applied, false);
  assert.equal(logCount(orderId, "ORDER_START"), 1);
  await balanceIs(requester.id, 90, 10);
  const release = await request("credit", `/credit/reservations/${orderId}/release`, { method: "POST", headers,
    body: { requesterId: requester.id, amount: 10 } });
  expectStatus(release, 200, "release isolated reservation");
  await balanceIs(requester.id, 100, 0);
}

async function cancelExpiryRace() {
  const requester = await actor();
  const orderId = await createOrder(requester);
  mongo(`d.errands.updateOne({_id:ObjectId("${orderId}")},{$set:{expiresAt:new Date(0)}})`);
  const cancellation = await request("order", `/errands/${orderId}/cancel`, { method: "POST", actor: requester });
  assert.ok([200, 409].includes(cancellation.status));
  const final = await until("one terminal outcome", () => {
    const status = errandDoc(orderId)?.status;
    return ["CANCELLED", "EXPIRED"].includes(status) ? status : false;
  }, 90_000);
  assert.ok(["CANCELLED", "EXPIRED"].includes(final));
  await balanceIs(requester.id, 100, 0);
  assert.equal(logCount(orderId, "ORDER_END"), 1);
  assert.equal(logDoc(orderId, "ORDER_END")?.action, "REFUND");
}

async function competingCouriers() {
  const requester = await actor();
  const courierA = await actor();
  const courierB = await actor();
  const orderId = await createOrder(requester);
  const outcomes = await Promise.all([courierA, courierB].map((person) =>
    request("order", `/errands/${orderId}/accept`, { method: "POST", actor: person })));
  assert.deepEqual(outcomes.map((result) => result.status).sort(), [200, 409]);
  const winner = outcomes[0].status === 200 ? courierA : courierB;
  assert.equal(errandDoc(orderId)?.courierId, winner.id);
  assert.equal(errandDoc(orderId)?.status, "ACCEPTED");
  assert.equal(logCount(orderId, "ORDER_START"), 1);
  assert.equal(logCount(orderId, "ORDER_END"), 0);
}

async function completionCancelConflict() {
  const requester = await actor();
  const courier = await actor();
  const orderId = await createOrder(requester);
  await transition(courier, orderId, "accept");
  await transition(courier, orderId, "pickup");
  await transition(courier, orderId, "deliver");
  const [completed, cancelled] = await Promise.all(["complete", "cancel"].map((action) =>
    request("order", `/errands/${orderId}/${action}`, { method: "POST", actor: requester })));
  assert.equal(completed.status, 200);
  assert.equal(cancelled.status, 409);
  assert.equal(errandDoc(orderId)?.status, "COMPLETED");
  await balanceIs(requester.id, 90, 0);
  await balanceIs(courier.id, 110, 0);
  assert.equal(logCount(orderId, "ORDER_END"), 1);
  assert.equal(logDoc(orderId, "ORDER_END")?.action, "TRANSFER");
}

async function rabbitOutage() {
  const requester = await actor();
  const orderId = await createOrder(requester);
  compose(["stop", "rabbitmq"], { timeout: 90_000 });
  try {
    await transition(requester, orderId, "cancel");
    assert.equal(errandDoc(orderId)?.eventPending, true);
    assert.equal(logCount(orderId, "ORDER_END"), 0);
    await balanceIs(requester.id, 90, 10);
  } finally {
    compose(["start", "rabbitmq"], { timeout: 90_000 });
    bases.rabbit = port("rabbitmq", 15672);
  }
  await until("reconnected RabbitMQ", async () => (await request("rabbit", "/api/overview", {
    headers: rabbitHeaders(), timeout: 3_000 })).status === 200, 90_000);
  await until("pending terminal event relay", () => errandDoc(orderId)?.eventPending !== true, 120_000);
  await balanceIs(requester.id, 100, 0);
  assert.equal(logCount(orderId, "ORDER_END"), 1);
}

function rabbitHeaders() {
  return { Authorization: `Basic ${Buffer.from(`${process.env.RABBITMQ_DEFAULT_USER}:${process.env.RABBITMQ_DEFAULT_PASS}`).toString("base64")}` };
}

async function rabbitPublish(routingKey, payload, messageId) {
  const response = await request("rabbit", "/api/exchanges/%2F/errand.events/publish", {
    method: "POST", headers: rabbitHeaders(), body: {
      properties: { delivery_mode: 2, content_type: "application/json", message_id: messageId },
      routing_key: routingKey, payload: JSON.stringify(payload), payload_encoding: "string",
    },
  });
  expectStatus(response, 200, "publish demo event");
  assert.equal(response.data?.routed, true, "event was not routed to Credit");
}

async function duplicateTerminalEvent() {
  const requester = await actor();
  const orderId = await createOrder(requester);
  await transition(requester, orderId, "cancel");
  await balanceIs(requester.id, 100, 0);
  const eventId = `${orderId}:errand.cancelled`;
  const event = { key: orderId, value: { eventId, type: "errand.cancelled", requesterId: requester.id,
    courierId: null, credit: 10, occurredAt: new Date().toISOString() } };
  await rabbitPublish("errand.cancelled", event, eventId);
  await until("duplicate Credit delivery", () => compose(["logs", "credit-service"])
    .includes(`Credit settled ${eventId}; applied=false`), 30_000);
  assert.equal(logCount(orderId, "ORDER_END"), 1);
  await balanceIs(requester.id, 100, 0);
}

async function deadLetter() {
  const count = async () => {
    const response = await request("rabbit", "/api/queues/%2F/credit.errand.events.dead", { headers: rabbitHeaders() });
    expectStatus(response, 200, "dead-letter queue");
    return response.data?.messages ?? 0;
  };
  const before = await count();
  const logsBefore = mongo("d.transactionLog.countDocuments({})");
  // Published as a JSON string by the management API, but its contents are not JSON.
  const response = await request("rabbit", "/api/exchanges/%2F/errand.events/publish", {
    method: "POST", headers: rabbitHeaders(), body: {
      properties: { delivery_mode: 2, content_type: "application/json", message_id: `demo-poison-${randomBytes(5).toString("hex")}` },
      routing_key: "errand.completed", payload: "not-json", payload_encoding: "string",
    },
  });
  expectStatus(response, 200, "publish invalid event");
  assert.equal(response.data?.routed, true);
  await until("dead-lettered invalid event", async () => (await count()) > before, 30_000);
  assert.equal(mongo("d.transactionLog.countDocuments({})"), logsBefore);
}

async function serviceOutages() {
  const person = await actor();
  const probes = [
    ["user-service", "/api/user/auth/me"],
    ["supplier-service", "/api/supplier/suppliers"],
    ["order-service", "/api/order/errands/mine"],
    ["credit-service", "/api/credit/credit/me/balance"],
  ];
  for (const [service, path] of probes) {
    compose(["stop", service], { timeout: 90_000 });
    try {
      const response = await request("front", path, { actor: person });
      assert.ok([502, 503, 504].includes(response.status), `${service} outage returned ${response.status}`);
    } finally {
      compose(["start", service], { timeout: 90_000 });
      bases[service === "user-service" ? "user" : service === "supplier-service" ? "supplier" :
        service === "order-service" ? "order" : "credit"] = port(service,
          service === "user-service" ? 3001 : service === "supplier-service" ? 3002 :
            service === "order-service" ? 3003 : 3004);
    }
    await until(`${service} recovery`, async () => {
      const response = await request("front", path, { actor: person, timeout: 3_000 });
      return response.status === 200;
    }, 90_000);
  }
  // A temporary User outage did not revoke a valid session.
  const me = await request("user", "/auth/me", { actor: person });
  expectStatus(me, 200, "session after User recovery");
}

async function main() {
  const scenario = process.argv.at(-1);
  if (scenario === "--help" || scenario === "help") { help(); return; }
  const selected = scenario === "all" ? [...cases.values()] :
    [...cases.values()].filter(([name], index) => name === scenario || [...cases.keys()][index] === scenario);
  if (!selected.length) throw new Error(`Unknown scenario '${scenario}'. Run with --help for valid names.`);
  if (process.argv[2] === "--validate") return;
  if (!process.env.DEMO_PROJECT) throw new Error("DEMO_PROJECT is missing; use saga-demo.sh");
  bases = Object.fromEntries([["user", "user-service", 3001], ["supplier", "supplier-service", 3002],
    ["order", "order-service", 3003], ["credit", "credit-service", 3004], ["front", "frontend", 80],
    ["rabbit", "rabbitmq", 15672], ["proxy", "demo-credit-proxy", 3900]]
    .map(([key, service, target]) => [key, port(service, target)]));
  await until("User Service", async () => (await request("user", "/health", { timeout: 3_000 })).status === 200);
  await until("Order Service", async () => (await request("order", "/health", { timeout: 3_000 })).status === 200);
  await until("Supplier seed", async () => {
    const response = await request("supplier", "/suppliers", { timeout: 3_000 });
    supplierId = response.data?.suppliers?.find((supplier) => supplier.isActive !== false)?._id;
    return supplierId;
  });
  for (const [name, title, run] of selected) {
    console.log(`\n▶ ${title}`);
    await run();
    console.log(`✓ ${name}`);
  }
  console.log(`\nPassed ${selected.length} scenario(s).`);
}

main().catch((error) => { console.error(`Demo failed: ${error.message}`); process.exitCode = 1; });
