const { createServiceApp, listen, sendErrors, sendNotFound } = require("../common/service-app");
const { ensureSeeded, openDatabase } = require("../common/database");
const { baseDocument, jsonResponse, mountSwagger } = require("../common/swagger");

const SERVICE_NAME = "Identity Service";
const PORT = Number(process.env.PORT || 5001);
const database = openDatabase("identity.sqlite");

database.exec(`
  CREATE TABLE IF NOT EXISTS Users (
    Id INTEGER PRIMARY KEY,
    Username TEXT NOT NULL UNIQUE,
    FullName TEXT NOT NULL,
    Rank TEXT NOT NULL CHECK (Rank IN ('Silver', 'Gold', 'Platinum'))
  );
`);

ensureSeeded(database, "Users", {
  sql: "INSERT INTO Users (Id, Username, FullName, Rank) VALUES (?, ?, ?, ?)",
  values: [
    [1, "sv01", "Nguyen Van A", "Gold"],
    [2, "sv02", "Tran Thi B", "Silver"]
  ]
});

const app = createServiceApp(SERVICE_NAME);

app.get("/api/users", (req, res) => {
  const users = database
    .prepare("SELECT Id, Username, FullName, Rank FROM Users ORDER BY Id")
    .all()
    .map(toUserDto);

  res.json(users);
});

app.get("/api/users/:id", (req, res) => {
  const user = findUser(req.params.id);

  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  res.json(toUserDto(user));
});

app.get("/api/users/:id/rank", (req, res) => {
  const user = findUser(req.params.id);

  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  res.json({
    id: user.Id,
    rank: user.Rank,
    maxActiveBorrows: rankLimit(user.Rank)
  });
});

app.post("/api/users", (req, res) => {
  const user = normalizeUserInput(req.body);

  if (!user.valid) {
    res.status(400).json({ message: user.message });
    return;
  }

  try {
    database
      .prepare("INSERT INTO Users (Id, Username, FullName, Rank) VALUES (?, ?, ?, ?)")
      .run(user.id, user.username, user.fullName, user.rank);

    res.status(201).json(toUserDto(findUser(user.id)));
  } catch (error) {
    res.status(409).json({
      message: "User id or username already exists",
      details: { database: error.message }
    });
  }
});

app.put("/api/users/:id/rank", (req, res) => {
  const id = Number(req.params.id);
  const rank = String(req.body.rank || "").trim();

  if (!["Silver", "Gold", "Platinum"].includes(rank)) {
    res.status(400).json({ message: "Rank must be Silver, Gold, or Platinum" });
    return;
  }

  const result = database
    .prepare("UPDATE Users SET Rank = ? WHERE Id = ?")
    .run(rank, id);

  if (result.changes === 0) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  res.json(toUserDto(findUser(id)));
});

mountSwagger(app, buildSwaggerDocument());
sendNotFound(app);
sendErrors(app);

if (require.main === module) {
  listen(app, PORT, SERVICE_NAME);
}

function findUser(id) {
  return database
    .prepare("SELECT Id, Username, FullName, Rank FROM Users WHERE Id = ?")
    .get(Number(id));
}

function rankLimit(rank) {
  const limits = {
    Silver: 3,
    Gold: 5,
    Platinum: 10
  };

  return limits[rank] || limits.Silver;
}

function toUserDto(row) {
  return {
    id: row.Id,
    username: row.Username,
    fullName: row.FullName,
    rank: row.Rank,
    maxActiveBorrows: rankLimit(row.Rank)
  };
}

function normalizeUserInput(body) {
  const id = Number(body.id);
  const username = String(body.username || "").trim();
  const fullName = String(body.fullName || "").trim();
  const rank = String(body.rank || "Silver").trim();

  if (!Number.isInteger(id) || id <= 0) {
    return { valid: false, message: "id must be a positive integer" };
  }

  if (!username || !fullName) {
    return { valid: false, message: "username and fullName are required" };
  }

  if (!["Silver", "Gold", "Platinum"].includes(rank)) {
    return { valid: false, message: "rank must be Silver, Gold, or Platinum" };
  }

  return { valid: true, id, username, fullName, rank };
}

function buildSwaggerDocument() {
  return baseDocument({
    title: "Identity Service API",
    port: PORT,
    description: "Quản lý tài khoản độc giả, phân quyền, và giới hạn số sách đang mượn theo hạng.",
    schemas: {
      User: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          username: { type: "string", example: "sv01" },
          fullName: { type: "string", example: "Nguyen Van A" },
          rank: { type: "string", enum: ["Silver", "Gold", "Platinum"], example: "Gold" },
          maxActiveBorrows: { type: "integer", example: 5 }
        }
      },
      CreateUserRequest: {
        type: "object",
        required: ["id", "username", "fullName"],
        properties: {
          id: { type: "integer", example: 3 },
          username: { type: "string", example: "sv03" },
          fullName: { type: "string", example: "Le Van C" },
          rank: { type: "string", enum: ["Silver", "Gold", "Platinum"], example: "Silver" }
        }
      },
      UpdateRankRequest: {
        type: "object",
        required: ["rank"],
        properties: {
          rank: { type: "string", enum: ["Silver", "Gold", "Platinum"], example: "Gold" }
        }
      }
    },
    paths: {
      "/api/users": {
        get: {
          summary: "List users",
          responses: {
            200: jsonResponse("Users in IdentityDB", {
              type: "array",
              items: { $ref: "#/components/schemas/User" }
            })
          }
        },
        post: {
          summary: "Create a reader account",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateUserRequest" }
              }
            }
          },
          responses: {
            201: jsonResponse("Created user", { $ref: "#/components/schemas/User" }),
            400: jsonResponse("Invalid input", { $ref: "#/components/schemas/ErrorResponse" }),
            409: jsonResponse("Duplicate user", { $ref: "#/components/schemas/ErrorResponse" })
          }
        }
      },
      "/api/users/{id}": {
        get: {
          summary: "Get a user by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            200: jsonResponse("User found", { $ref: "#/components/schemas/User" }),
            404: jsonResponse("User not found", { $ref: "#/components/schemas/ErrorResponse" })
          }
        }
      },
      "/api/users/{id}/rank": {
        get: {
          summary: "Check user rank and active borrowing limit",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            200: jsonResponse("Rank and limit", {
              type: "object",
              properties: {
                id: { type: "integer" },
                rank: { type: "string" },
                maxActiveBorrows: { type: "integer" }
              }
            }),
            404: jsonResponse("User not found", { $ref: "#/components/schemas/ErrorResponse" })
          }
        },
        put: {
          summary: "Update user rank",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateRankRequest" }
              }
            }
          },
          responses: {
            200: jsonResponse("Updated user", { $ref: "#/components/schemas/User" }),
            400: jsonResponse("Invalid rank", { $ref: "#/components/schemas/ErrorResponse" }),
            404: jsonResponse("User not found", { $ref: "#/components/schemas/ErrorResponse" })
          }
        }
      }
    }
  });
}

module.exports = app;
