const { createServiceApp, listen, sendErrors, sendNotFound } = require("../common/service-app");
const { openDatabase } = require("../common/database");
const { baseDocument, jsonResponse, mountSwagger } = require("../common/swagger");

const SERVICE_NAME = "Notification Service";
const PORT = Number(process.env.PORT || 5004);
const database = openDatabase("notification.sqlite");

database.exec(`
  CREATE TABLE IF NOT EXISTS Logs (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Message TEXT NOT NULL,
    UserId INTEGER NULL,
    BookId INTEGER NULL,
    BorrowRecordId INTEGER NULL,
    SentDate TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const app = createServiceApp(SERVICE_NAME);

app.get("/api/notifications", listLogs);
app.get("/api/notifications/logs", listLogs);

app.post("/api/notifications", (req, res) => {
  const message = String(req.body.message || "").trim();
  const userId = nullableInteger(req.body.userId);
  const bookId = nullableInteger(req.body.bookId);
  const borrowRecordId = nullableInteger(req.body.borrowRecordId);

  if (!message) {
    res.status(400).json({ message: "message is required" });
    return;
  }

  const result = database
    .prepare(`
      INSERT INTO Logs (Message, UserId, BookId, BorrowRecordId, SentDate)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(message, userId, bookId, borrowRecordId, new Date().toISOString());

  const log = database
    .prepare("SELECT Id, Message, UserId, BookId, BorrowRecordId, SentDate FROM Logs WHERE Id = ?")
    .get(Number(result.lastInsertRowid));

  res.status(201).json(toLogDto(log));
});

mountSwagger(app, buildSwaggerDocument());
sendNotFound(app);
sendErrors(app);

if (require.main === module) {
  listen(app, PORT, SERVICE_NAME);
}

function listLogs(req, res) {
  const logs = database
    .prepare("SELECT Id, Message, UserId, BookId, BorrowRecordId, SentDate FROM Logs ORDER BY Id DESC")
    .all()
    .map(toLogDto);

  res.json(logs);
}

function nullableInteger(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : null;
}

function toLogDto(row) {
  return {
    id: row.Id,
    message: row.Message,
    userId: row.UserId,
    bookId: row.BookId,
    borrowRecordId: row.BorrowRecordId,
    sentDate: row.SentDate
  };
}

function buildSwaggerDocument() {
  return baseDocument({
    title: "Notification Service API",
    port: PORT,
    description: "Ghi log thông báo giả lập khi mượn hoặc trả sách thành công.",
    schemas: {
      NotificationLog: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          message: { type: "string", example: "Nguyen Van A borrowed Clean Code" },
          userId: { type: "integer", nullable: true, example: 1 },
          bookId: { type: "integer", nullable: true, example: 101 },
          borrowRecordId: { type: "integer", nullable: true, example: 1 },
          sentDate: { type: "string", format: "date-time" }
        }
      },
      CreateNotificationRequest: {
        type: "object",
        required: ["message"],
        properties: {
          message: { type: "string", example: "Borrowing completed successfully" },
          userId: { type: "integer", nullable: true, example: 1 },
          bookId: { type: "integer", nullable: true, example: 101 },
          borrowRecordId: { type: "integer", nullable: true, example: 1 }
        }
      }
    },
    paths: {
      "/api/notifications": {
        get: {
          summary: "List notification logs",
          responses: {
            200: jsonResponse("Notification logs", {
              type: "array",
              items: { $ref: "#/components/schemas/NotificationLog" }
            })
          }
        },
        post: {
          summary: "Create a notification log",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateNotificationRequest" }
              }
            }
          },
          responses: {
            201: jsonResponse("Created notification log", {
              $ref: "#/components/schemas/NotificationLog"
            }),
            400: jsonResponse("Invalid input", { $ref: "#/components/schemas/ErrorResponse" })
          }
        }
      },
      "/api/notifications/logs": {
        get: {
          summary: "List notification logs",
          responses: {
            200: jsonResponse("Notification logs", {
              type: "array",
              items: { $ref: "#/components/schemas/NotificationLog" }
            })
          }
        }
      }
    }
  });
}

module.exports = app;
