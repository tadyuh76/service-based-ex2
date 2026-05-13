const { createServiceApp, listen, sendErrors, sendNotFound } = require("../common/service-app");
const { openDatabase } = require("../common/database");
const { requestJson } = require("../common/http-client");
const { baseDocument, jsonResponse, mountSwagger } = require("../common/swagger");

const SERVICE_NAME = "Borrowing Service";
const PORT = Number(process.env.PORT || 5003);
const IDENTITY_SERVICE_URL = process.env.IDENTITY_SERVICE_URL || "http://localhost:5001";
const BOOK_SERVICE_URL = process.env.BOOK_SERVICE_URL || "http://localhost:5002";
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || "http://localhost:5004";
const database = openDatabase("borrowing.sqlite");

database.exec(`
  CREATE TABLE IF NOT EXISTS BorrowRecords (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    UserId INTEGER NOT NULL,
    BookId INTEGER NOT NULL,
    BorrowDate TEXT NOT NULL,
    ReturnDate TEXT NULL
  );
`);

const app = createServiceApp(SERVICE_NAME);

app.get("/api/borrow", (req, res) => {
  const onlyActive = String(req.query.active || "").toLowerCase() === "true";
  const sql = onlyActive
    ? "SELECT Id, UserId, BookId, BorrowDate, ReturnDate FROM BorrowRecords WHERE ReturnDate IS NULL ORDER BY Id DESC"
    : "SELECT Id, UserId, BookId, BorrowDate, ReturnDate FROM BorrowRecords ORDER BY Id DESC";

  const records = database.prepare(sql).all().map(toBorrowRecordDto);
  res.json(records);
});

app.get("/api/borrow/:id", (req, res) => {
  const record = findRecord(req.params.id);

  if (!record) {
    res.status(404).json({ message: "Borrow record not found" });
    return;
  }

  res.json(toBorrowRecordDto(record));
});

app.get("/api/borrow/users/:userId/active-count", (req, res) => {
  const userId = Number(req.params.userId);

  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ message: "userId must be a positive integer" });
    return;
  }

  res.json({
    userId,
    activeBorrowCount: activeBorrowCount(userId)
  });
});

app.post("/api/borrow", async (req, res) => {
  const input = normalizeBorrowInput(req);

  if (!input.valid) {
    res.status(400).json({ message: input.message });
    return;
  }

  const userResult = await requestJson(
    `${IDENTITY_SERVICE_URL}/api/users/${input.userId}`,
    {},
    "Identity Service"
  );

  if (!userResult.ok) {
    res.status(userResult.status === 404 ? 400 : 503).json({
      message: "Cannot validate reader account",
      details: userResult
    });
    return;
  }

  const bookResult = await requestJson(
    `${BOOK_SERVICE_URL}/api/books/${input.bookId}`,
    {},
    "Book Service"
  );

  if (!bookResult.ok) {
    res.status(bookResult.status === 404 ? 400 : 503).json({
      message: "Cannot validate book availability",
      details: bookResult
    });
    return;
  }

  const user = userResult.data;
  const book = bookResult.data;
  const activeCount = activeBorrowCount(input.userId);
  const maxActiveBorrows = Number(user.maxActiveBorrows || rankLimit(user.rank));

  if (activeCount >= maxActiveBorrows) {
    res.status(409).json({
      message: `Reader rank ${user.rank} may only have ${maxActiveBorrows} active borrow(s)`,
      details: {
        userId: input.userId,
        activeBorrowCount: activeCount,
        maxActiveBorrows
      }
    });
    return;
  }

  if (Number(book.stock) <= 0) {
    res.status(409).json({
      message: "Book is out of stock",
      details: { bookId: input.bookId, stock: book.stock }
    });
    return;
  }

  const recordId = createBorrowRecord(input.userId, input.bookId);
  const stockResult = await requestJson(
    `${BOOK_SERVICE_URL}/api/books/${input.bookId}/stock`,
    { method: "PUT", body: { delta: -1 } },
    "Book Service"
  );

  if (!stockResult.ok) {
    deleteBorrowRecord(recordId);
    res.status(stockResult.status === 409 ? 409 : 503).json({
      message: "Borrow record was not saved because stock update failed",
      details: stockResult
    });
    return;
  }

  const notifyResult = await requestJson(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    {
      method: "POST",
      body: {
        message: `${user.fullName} borrowed "${book.title}" successfully.`,
        userId: input.userId,
        bookId: input.bookId,
        borrowRecordId: recordId
      }
    },
    "Notification Service"
  );

  res.status(201).json({
    message: "Borrowing completed successfully",
    record: toBorrowRecordDto(findRecord(recordId)),
    user,
    book: stockResult.data,
    notification: notifyResult.ok
      ? notifyResult.data
      : {
          status: "failed",
          details: notifyResult
        }
  });
});

app.put("/api/borrow/:id/return", async (req, res) => {
  const record = findRecord(req.params.id);

  if (!record) {
    res.status(404).json({ message: "Borrow record not found" });
    return;
  }

  if (record.ReturnDate) {
    res.status(409).json({
      message: "Borrow record has already been returned",
      record: toBorrowRecordDto(record)
    });
    return;
  }

  const returnDate = new Date().toISOString();
  database
    .prepare("UPDATE BorrowRecords SET ReturnDate = ? WHERE Id = ?")
    .run(returnDate, record.Id);

  const stockResult = await requestJson(
    `${BOOK_SERVICE_URL}/api/books/${record.BookId}/stock`,
    { method: "PUT", body: { delta: 1 } },
    "Book Service"
  );

  if (!stockResult.ok) {
    database
      .prepare("UPDATE BorrowRecords SET ReturnDate = NULL WHERE Id = ?")
      .run(record.Id);

    res.status(503).json({
      message: "Return was rolled back because stock update failed",
      details: stockResult
    });
    return;
  }

  const notifyResult = await requestJson(
    `${NOTIFICATION_SERVICE_URL}/api/notifications`,
    {
      method: "POST",
      body: {
        message: `Borrow record #${record.Id} was returned successfully.`,
        userId: record.UserId,
        bookId: record.BookId,
        borrowRecordId: record.Id
      }
    },
    "Notification Service"
  );

  res.json({
    message: "Return completed successfully",
    record: toBorrowRecordDto(findRecord(record.Id)),
    book: stockResult.data,
    notification: notifyResult.ok
      ? notifyResult.data
      : {
          status: "failed",
          details: notifyResult
        }
  });
});

mountSwagger(app, buildSwaggerDocument());
sendNotFound(app);
sendErrors(app);

if (require.main === module) {
  listen(app, PORT, SERVICE_NAME);
}

function normalizeBorrowInput(req) {
  const userId = Number(req.body.userId || req.query.userId);
  const bookId = Number(req.body.bookId || req.query.bookId);

  if (!Number.isInteger(userId) || userId <= 0) {
    return { valid: false, message: "userId must be a positive integer" };
  }

  if (!Number.isInteger(bookId) || bookId <= 0) {
    return { valid: false, message: "bookId must be a positive integer" };
  }

  return { valid: true, userId, bookId };
}

function rankLimit(rank) {
  const limits = {
    Silver: 3,
    Gold: 5,
    Platinum: 10
  };

  return limits[rank] || limits.Silver;
}

function activeBorrowCount(userId) {
  return database
    .prepare("SELECT COUNT(*) AS total FROM BorrowRecords WHERE UserId = ? AND ReturnDate IS NULL")
    .get(userId).total;
}

function createBorrowRecord(userId, bookId) {
  const result = database
    .prepare("INSERT INTO BorrowRecords (UserId, BookId, BorrowDate, ReturnDate) VALUES (?, ?, ?, NULL)")
    .run(userId, bookId, new Date().toISOString());

  return Number(result.lastInsertRowid);
}

function deleteBorrowRecord(id) {
  database.prepare("DELETE FROM BorrowRecords WHERE Id = ?").run(id);
}

function findRecord(id) {
  return database
    .prepare("SELECT Id, UserId, BookId, BorrowDate, ReturnDate FROM BorrowRecords WHERE Id = ?")
    .get(Number(id));
}

function toBorrowRecordDto(row) {
  return {
    id: row.Id,
    userId: row.UserId,
    bookId: row.BookId,
    borrowDate: row.BorrowDate,
    returnDate: row.ReturnDate
  };
}

function buildSwaggerDocument() {
  return baseDocument({
    title: "Borrowing Service API",
    port: PORT,
    description:
      "Quản lý nghiệp vụ mượn/trả sách. Service này gọi Identity, Book, và Notification qua HTTP.",
    schemas: {
      BorrowRecord: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          userId: { type: "integer", example: 1 },
          bookId: { type: "integer", example: 101 },
          borrowDate: { type: "string", format: "date-time" },
          returnDate: { type: "string", format: "date-time", nullable: true }
        }
      },
      CreateBorrowRequest: {
        type: "object",
        required: ["userId", "bookId"],
        properties: {
          userId: { type: "integer", example: 1 },
          bookId: { type: "integer", example: 101 }
        }
      }
    },
    paths: {
      "/api/borrow": {
        get: {
          summary: "List borrow records",
          parameters: [
            {
              name: "active",
              in: "query",
              required: false,
              schema: { type: "boolean" },
              description: "When true, only records without ReturnDate are returned."
            }
          ],
          responses: {
            200: jsonResponse("Borrow records in BorrowingDB", {
              type: "array",
              items: { $ref: "#/components/schemas/BorrowRecord" }
            })
          }
        },
        post: {
          summary: "Borrow a book through the inter-service workflow",
          description:
            "Checks reader rank in Identity, checks stock in Book, saves BorrowingDB, decreases stock, then logs a notification.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateBorrowRequest" }
              }
            }
          },
          responses: {
            201: jsonResponse("Borrowing completed", {
              type: "object",
              properties: {
                message: { type: "string" },
                record: { $ref: "#/components/schemas/BorrowRecord" }
              }
            }),
            400: jsonResponse("Invalid user or book", { $ref: "#/components/schemas/ErrorResponse" }),
            409: jsonResponse("Borrowing rule rejected request", { $ref: "#/components/schemas/ErrorResponse" }),
            503: jsonResponse("Dependency service unavailable", { $ref: "#/components/schemas/ErrorResponse" })
          }
        }
      },
      "/api/borrow/{id}": {
        get: {
          summary: "Get borrow record by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            200: jsonResponse("Borrow record", { $ref: "#/components/schemas/BorrowRecord" }),
            404: jsonResponse("Borrow record not found", { $ref: "#/components/schemas/ErrorResponse" })
          }
        }
      },
      "/api/borrow/{id}/return": {
        put: {
          summary: "Return a borrowed book",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            200: jsonResponse("Return completed", {
              type: "object",
              properties: {
                message: { type: "string" },
                record: { $ref: "#/components/schemas/BorrowRecord" }
              }
            }),
            404: jsonResponse("Borrow record not found", { $ref: "#/components/schemas/ErrorResponse" }),
            409: jsonResponse("Already returned", { $ref: "#/components/schemas/ErrorResponse" }),
            503: jsonResponse("Dependency service unavailable", { $ref: "#/components/schemas/ErrorResponse" })
          }
        }
      },
      "/api/borrow/users/{userId}/active-count": {
        get: {
          summary: "Count active borrow records for a user",
          parameters: [{ name: "userId", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            200: jsonResponse("Active borrow count", {
              type: "object",
              properties: {
                userId: { type: "integer" },
                activeBorrowCount: { type: "integer" }
              }
            })
          }
        }
      }
    }
  });
}

module.exports = app;
