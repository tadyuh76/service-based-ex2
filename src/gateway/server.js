const { createServiceApp, listen, sendErrors, sendNotFound } = require("../common/service-app");
const { baseDocument, jsonResponse, mountSwagger } = require("../common/swagger");

const SERVICE_NAME = "Gateway";
const PORT = Number(process.env.PORT || 8000);
const TARGETS = {
  "/api/users": process.env.IDENTITY_SERVICE_URL || "http://localhost:5001",
  "/api/books": process.env.BOOK_SERVICE_URL || "http://localhost:5002",
  "/api/borrow": process.env.BORROWING_SERVICE_URL || "http://localhost:5003",
  "/api/notifications": process.env.NOTIFICATION_SERVICE_URL || "http://localhost:5004"
};

const app = createServiceApp(SERVICE_NAME);

app.get("/", (req, res) => {
  res.json({
    message: "Digital Library Gateway",
    routes: Object.entries(TARGETS).map(([prefix, target]) => ({ prefix, target })),
    swagger: `http://localhost:${PORT}/swagger`
  });
});

for (const [prefix, target] of Object.entries(TARGETS)) {
  app.use(prefix, proxyTo(target));
}

mountSwagger(app, buildSwaggerDocument());
sendNotFound(app);
sendErrors(app);

if (require.main === module) {
  listen(app, PORT, SERVICE_NAME);
}

function proxyTo(target) {
  return async (req, res) => {
    const upstreamUrl = new URL(req.originalUrl, target);
    const headers = {};

    for (const [key, value] of Object.entries(req.headers)) {
      if (!["host", "connection", "content-length"].includes(key.toLowerCase())) {
        headers[key] = value;
      }
    }

    if (!headers.accept) {
      headers.accept = "application/json";
    }

    if (!["GET", "HEAD"].includes(req.method) && req.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    try {
      const upstream = await fetch(upstreamUrl, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body || {})
      });

      const contentType = upstream.headers.get("content-type");
      if (contentType) {
        res.setHeader("content-type", contentType);
      }

      res.status(upstream.status).send(await upstream.text());
    } catch (error) {
      res.status(503).json({
        message: "Gateway could not reach target service",
        details: {
          target,
          path: req.originalUrl,
          error: error.message
        }
      });
    }
  };
}

function buildSwaggerDocument() {
  return baseDocument({
    title: "Digital Library Gateway API",
    port: PORT,
    description:
      "Gateway duy nhất chạy tại port 8000, chuyển tiếp request đến các service độc lập.",
    schemas: {
      BorrowRequest: {
        type: "object",
        required: ["userId", "bookId"],
        properties: {
          userId: { type: "integer", example: 1 },
          bookId: { type: "integer", example: 101 }
        }
      }
    },
    paths: {
      "/api/users": {
        get: {
          summary: "Proxy to Identity Service - list users",
          responses: {
            200: jsonResponse("Users", { type: "array", items: { type: "object" } })
          }
        }
      },
      "/api/users/{id}": {
        get: {
          summary: "Proxy to Identity Service - get user",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            200: jsonResponse("User", { type: "object" }),
            404: jsonResponse("User not found", { $ref: "#/components/schemas/ErrorResponse" })
          }
        }
      },
      "/api/books": {
        get: {
          summary: "Proxy to Book Service - list books",
          responses: {
            200: jsonResponse("Books", { type: "array", items: { type: "object" } })
          }
        }
      },
      "/api/books/{id}": {
        get: {
          summary: "Proxy to Book Service - get book",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            200: jsonResponse("Book", { type: "object" }),
            404: jsonResponse("Book not found", { $ref: "#/components/schemas/ErrorResponse" })
          }
        }
      },
      "/api/borrow": {
        get: {
          summary: "Proxy to Borrowing Service - list borrow records",
          responses: {
            200: jsonResponse("Borrow records", { type: "array", items: { type: "object" } })
          }
        },
        post: {
          summary: "Proxy to Borrowing Service - borrow a book",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BorrowRequest" }
              }
            }
          },
          responses: {
            201: jsonResponse("Borrowing completed", { type: "object" }),
            400: jsonResponse("Invalid user or book", { $ref: "#/components/schemas/ErrorResponse" }),
            409: jsonResponse("Rule violation", { $ref: "#/components/schemas/ErrorResponse" }),
            503: jsonResponse("Dependency unavailable", { $ref: "#/components/schemas/ErrorResponse" })
          }
        }
      },
      "/api/borrow/{id}/return": {
        put: {
          summary: "Proxy to Borrowing Service - return a book",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            200: jsonResponse("Return completed", { type: "object" }),
            404: jsonResponse("Borrow record not found", { $ref: "#/components/schemas/ErrorResponse" })
          }
        }
      },
      "/api/notifications": {
        get: {
          summary: "Proxy to Notification Service - list logs",
          responses: {
            200: jsonResponse("Notification logs", { type: "array", items: { type: "object" } })
          }
        }
      }
    }
  });
}

module.exports = app;
