import { createServer } from "node:http";

const target = process.env.DEMO_CREDIT_TARGET;
const controlToken = process.env.DEMO_CONTROL_TOKEN;
if (!target || !controlToken) throw new Error("Demo proxy configuration is missing");

let fault = { mode: "none", method: "", path: "", remaining: 0, hits: 0 };

async function bodyOf(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function authorized(request) {
  return request.headers["x-demo-control-token"] === controlToken;
}

async function forward(request, response, pathname) {
  const pathMatches = fault.path.endsWith("*")
    ? pathname.startsWith(fault.path.slice(0, -1))
    : pathname === fault.path;
  const applies = fault.mode !== "none" && fault.method === request.method && pathMatches &&
    (fault.remaining === -1 || fault.remaining > 0);
  const mode = applies ? fault.mode : "none";
  if (applies) {
    fault.hits++;
    if (fault.remaining > 0) fault.remaining--;
  }
  if (mode === "fail") {
    json(response, 503, { error: "Demo Credit outage" });
    return;
  }

  try {
    const body = await bodyOf(request);
    const upstream = await fetch(new URL(request.url, target), {
      method: request.method,
      headers: {
        ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
        ...(request.headers["content-type"] ? { "content-type": request.headers["content-type"] } : {}),
      },
      ...(body.length ? { body } : {}),
    });
    const responseBody = Buffer.from(await upstream.arrayBuffer());
    if (mode === "drop-after") {
      response.destroy();
      return;
    }
    response.writeHead(upstream.status, {
      ...(upstream.headers.get("content-type") ? { "content-type": upstream.headers.get("content-type") } : {}),
    });
    response.end(responseBody);
  } catch {
    if (!response.destroyed) json(response, 503, { error: "Demo Credit proxy unavailable" });
  }
}

createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://demo-credit-proxy").pathname;
  if (pathname === "/health") { json(response, 200, { ok: true }); return; }
  if (pathname.startsWith("/__demo/")) {
    if (!authorized(request)) { json(response, 403, { error: "Forbidden" }); return; }
    if (pathname === "/__demo/state" && request.method === "GET") {
      json(response, 200, fault);
      return;
    }
    if (pathname === "/__demo/fault" && request.method === "POST") {
      let input;
      try { input = JSON.parse((await bodyOf(request)).toString("utf8")); } catch { /* reject below */ }
      if (!input || !["none", "fail", "drop-after"].includes(input.mode) ||
          input.mode !== "none" && (typeof input.path !== "string" || !input.path.startsWith("/credit/") ||
          !["GET", "POST", "PUT"].includes(input.method) ||
          !Number.isInteger(input.count) || input.count < -1 || input.count === 0)) {
        json(response, 400, { error: "Invalid demo fault" });
        return;
      }
      fault = { mode: input.mode, method: input.method ?? "", path: input.path ?? "", remaining: input.count ?? 0, hits: 0 };
      json(response, 200, fault);
      return;
    }
    json(response, 404, { error: "Unknown demo control" });
    return;
  }
  await forward(request, response, pathname);
}).listen(3900, "0.0.0.0");
