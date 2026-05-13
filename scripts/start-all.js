const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dataDir = path.join(root, "data");

const services = [
  {
    name: "identity",
    script: "src/identity-service/server.js",
    env: { PORT: "5001" }
  },
  {
    name: "book",
    script: "src/book-service/server.js",
    env: { PORT: "5002" }
  },
  {
    name: "notification",
    script: "src/notification-service/server.js",
    env: { PORT: "5004" }
  },
  {
    name: "borrowing",
    script: "src/borrowing-service/server.js",
    env: {
      PORT: "5003",
      IDENTITY_SERVICE_URL: "http://localhost:5001",
      BOOK_SERVICE_URL: "http://localhost:5002",
      NOTIFICATION_SERVICE_URL: "http://localhost:5004"
    }
  },
  {
    name: "gateway",
    script: "src/gateway/server.js",
    env: {
      PORT: "8000",
      IDENTITY_SERVICE_URL: "http://localhost:5001",
      BOOK_SERVICE_URL: "http://localhost:5002",
      BORROWING_SERVICE_URL: "http://localhost:5003",
      NOTIFICATION_SERVICE_URL: "http://localhost:5004"
    }
  },
  {
    name: "frontend",
    script: "src/frontend/server.js",
    env: { PORT: "3001" }
  }
];

const children = services.map(startService);

console.log("");
console.log("Digital Library System");
console.log("Frontend:      http://localhost:3001");
console.log("Gateway:       http://localhost:8000/swagger");
console.log("Identity API:  http://localhost:5001/swagger");
console.log("Book API:      http://localhost:5002/swagger");
console.log("Borrowing API: http://localhost:5003/swagger");
console.log("Notify API:    http://localhost:5004/swagger");
console.log("");
console.log("Press Ctrl+C to stop all services.");

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
process.on("exit", () => {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
});

function startService(service) {
  const child = spawn(process.execPath, [path.join(root, service.script)], {
    cwd: root,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
      DATA_DIR: dataDir,
      ...service.env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => writeServiceLog(service.name, chunk));
  child.stderr.on("data", (chunk) => writeServiceLog(service.name, chunk));
  child.on("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM" && signal !== "SIGINT") {
      console.error(`[${service.name}] exited with code ${code}`);
    }
  });

  return child;
}

function writeServiceLog(name, chunk) {
  const lines = chunk.toString().trimEnd().split("\n").filter(Boolean);
  for (const line of lines) {
    console.log(`[${name}] ${line}`);
  }
}

function stopAll() {
  console.log("\nStopping services...");
  for (const child of children) {
    child.kill("SIGTERM");
  }
  process.exit(0);
}
