const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.join(__dirname, "..");
const dataDir = path.join(root, ".smoke-data");
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

const services = [
  {
    name: "identity",
    script: "src/identity-service/server.js",
    port: 6101,
    health: "http://localhost:6101/health"
  },
  {
    name: "book",
    script: "src/book-service/server.js",
    port: 6102,
    health: "http://localhost:6102/health"
  },
  {
    name: "notification",
    script: "src/notification-service/server.js",
    port: 6104,
    health: "http://localhost:6104/health"
  },
  {
    name: "borrowing",
    script: "src/borrowing-service/server.js",
    port: 6103,
    health: "http://localhost:6103/health",
    env: {
      IDENTITY_SERVICE_URL: "http://localhost:6101",
      BOOK_SERVICE_URL: "http://localhost:6102",
      NOTIFICATION_SERVICE_URL: "http://localhost:6104"
    }
  },
  {
    name: "gateway",
    script: "src/gateway/server.js",
    port: 8100,
    health: "http://localhost:8100/health",
    env: {
      IDENTITY_SERVICE_URL: "http://localhost:6101",
      BOOK_SERVICE_URL: "http://localhost:6102",
      BORROWING_SERVICE_URL: "http://localhost:6103",
      NOTIFICATION_SERVICE_URL: "http://localhost:6104"
    }
  },
  {
    name: "frontend",
    script: "src/frontend/server.js",
    port: 3100,
    health: "http://localhost:3100/health"
  }
];

const children = [];
const logs = new Map();

main().catch((error) => {
  console.error(error.message);
  for (const [name, entries] of logs.entries()) {
    console.error(`\n[${name}] recent logs`);
    console.error(entries.slice(-20).join(""));
  }
  process.exitCode = 1;
}).finally(stopAll);

async function main() {
  for (const service of services) {
    startService(service);
  }

  for (const service of services) {
    await waitFor(service.health, service.name);
  }

  const gateway = "http://localhost:8100";
  const users = await getJson(`${gateway}/api/users`);
  assert(users.length >= 2, "Expected seeded users");

  const booksBefore = await getJson(`${gateway}/api/books`);
  const cleanCode = booksBefore.find((book) => book.id === 101);
  assert(cleanCode && cleanCode.stock === 5, "Expected seeded Clean Code stock");

  const firstBorrow = await postJson(`${gateway}/api/borrow`, { userId: 2, bookId: 101 });
  assert(firstBorrow.record.id > 0, "Expected borrow record id");

  await postJson(`${gateway}/api/borrow`, { userId: 2, bookId: 101 });
  await postJson(`${gateway}/api/borrow`, { userId: 2, bookId: 101 });

  const limitResponse = await fetch(`${gateway}/api/borrow`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ userId: 2, bookId: 101 })
  });
  assert(limitResponse.status === 409, "Expected Silver user to be limited to three active borrows");

  const booksAfter = await getJson(`${gateway}/api/books`);
  const updatedCleanCode = booksAfter.find((book) => book.id === 101);
  assert(updatedCleanCode.stock === 2, "Expected stock to decrement after successful borrows");

  const logsAfter = await getJson(`${gateway}/api/notifications`);
  assert(logsAfter.length >= 3, "Expected notification logs after borrows");

  const returnResult = await putJson(`${gateway}/api/borrow/${firstBorrow.record.id}/return`);
  assert(returnResult.record.returnDate, "Expected returned record to have returnDate");

  const swaggerResponse = await fetch("http://localhost:6101/swagger.json");
  assert(swaggerResponse.ok, "Expected Swagger JSON for Identity Service");

  const frontendResponse = await fetch("http://localhost:3100/");
  assert(frontendResponse.ok, "Expected frontend to serve index page");

  console.log("Smoke test passed: services, gateway, SQLite databases, Swagger, and frontend are runnable.");
}

function startService(service) {
  logs.set(service.name, []);
  const child = spawn(process.execPath, [path.join(root, service.script)], {
    cwd: root,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
      DATA_DIR: dataDir,
      PORT: String(service.port),
      ...(service.env || {})
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => captureLog(service.name, chunk));
  child.stderr.on("data", (chunk) => captureLog(service.name, chunk));
  children.push(child);
}

function captureLog(name, chunk) {
  logs.get(name).push(chunk.toString());
}

async function waitFor(url, serviceName) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      await sleep(150);
    }
  }
  throw new Error(`Timed out waiting for ${serviceName}`);
}

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  return parseResponse(url, response);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  });
  return parseResponse(url, response);
}

async function putJson(url, body = {}) {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  });
  return parseResponse(url, response);
}

async function parseResponse(url, response) {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}: ${text}`);
  }

  return payload;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopAll() {
  for (const child of children) {
    child.kill("SIGTERM");
  }
}
