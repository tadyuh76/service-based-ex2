const { createServiceApp, listen, sendErrors, sendNotFound } = require("../common/service-app");
const { ensureSeeded, openDatabase } = require("../common/database");
const { baseDocument, jsonResponse, mountSwagger } = require("../common/swagger");

const SERVICE_NAME = "Book Service";
const PORT = Number(process.env.PORT || 5002);
const database = openDatabase("book.sqlite");

database.exec(`
  CREATE TABLE IF NOT EXISTS Books (
    Id INTEGER PRIMARY KEY,
    Title TEXT NOT NULL,
    Author TEXT NOT NULL,
    Stock INTEGER NOT NULL CHECK (Stock >= 0)
  );
`);

ensureSeeded(database, "Books", {
  sql: "INSERT INTO Books (Id, Title, Author, Stock) VALUES (?, ?, ?, ?)",
  values: [
    [101, "Clean Code", "Robert C. Martin", 5],
    [102, "Design Patterns", "Gang of Four", 2],
    [103, "Refactoring", "Martin Fowler", 4],
    [104, "Domain-Driven Design", "Eric Evans", 3]
  ]
});

const app = createServiceApp(SERVICE_NAME);

app.get("/api/books", (req, res) => {
  const books = database
    .prepare("SELECT Id, Title, Author, Stock FROM Books ORDER BY Id")
    .all()
    .map(toBookDto);

  res.json(books);
});

app.get("/api/books/:id", (req, res) => {
  const book = findBook(req.params.id);

  if (!book) {
    res.status(404).json({ message: "Book not found" });
    return;
  }

  res.json(toBookDto(book));
});

app.post("/api/books", (req, res) => {
  const book = normalizeBookInput(req.body);

  if (!book.valid) {
    res.status(400).json({ message: book.message });
    return;
  }

  try {
    database
      .prepare("INSERT INTO Books (Id, Title, Author, Stock) VALUES (?, ?, ?, ?)")
      .run(book.id, book.title, book.author, book.stock);

    res.status(201).json(toBookDto(findBook(book.id)));
  } catch (error) {
    res.status(409).json({
      message: "Book id already exists",
      details: { database: error.message }
    });
  }
});

app.put("/api/books/:id/stock", (req, res) => {
  const id = Number(req.params.id);
  const book = findBook(id);

  if (!book) {
    res.status(404).json({ message: "Book not found" });
    return;
  }

  const update = normalizeStockUpdate(req.body, book.Stock);

  if (!update.valid) {
    res.status(400).json({ message: update.message });
    return;
  }

  if (update.stock < 0) {
    res.status(409).json({ message: "Book stock cannot go below zero" });
    return;
  }

  database
    .prepare("UPDATE Books SET Stock = ? WHERE Id = ?")
    .run(update.stock, id);

  res.json(toBookDto(findBook(id)));
});

mountSwagger(app, buildSwaggerDocument());
sendNotFound(app);
sendErrors(app);

if (require.main === module) {
  listen(app, PORT, SERVICE_NAME);
}

function findBook(id) {
  return database
    .prepare("SELECT Id, Title, Author, Stock FROM Books WHERE Id = ?")
    .get(Number(id));
}

function toBookDto(row) {
  return {
    id: row.Id,
    title: row.Title,
    author: row.Author,
    stock: row.Stock
  };
}

function normalizeBookInput(body) {
  const id = Number(body.id);
  const title = String(body.title || "").trim();
  const author = String(body.author || "").trim();
  const stock = Number(body.stock);

  if (!Number.isInteger(id) || id <= 0) {
    return { valid: false, message: "id must be a positive integer" };
  }

  if (!title || !author) {
    return { valid: false, message: "title and author are required" };
  }

  if (!Number.isInteger(stock) || stock < 0) {
    return { valid: false, message: "stock must be a non-negative integer" };
  }

  return { valid: true, id, title, author, stock };
}

function normalizeStockUpdate(body, currentStock) {
  if (Object.prototype.hasOwnProperty.call(body, "stock")) {
    const stock = Number(body.stock);

    if (!Number.isInteger(stock)) {
      return { valid: false, message: "stock must be an integer" };
    }

    return { valid: true, stock };
  }

  if (Object.prototype.hasOwnProperty.call(body, "delta")) {
    const delta = Number(body.delta);

    if (!Number.isInteger(delta) || delta === 0) {
      return { valid: false, message: "delta must be a non-zero integer" };
    }

    return { valid: true, stock: currentStock + delta };
  }

  return { valid: false, message: "request body must contain stock or delta" };
}

function buildSwaggerDocument() {
  return baseDocument({
    title: "Book Service API",
    port: PORT,
    description: "Quản lý danh mục sách, tác giả, và số lượng sách tồn kho.",
    schemas: {
      Book: {
        type: "object",
        properties: {
          id: { type: "integer", example: 101 },
          title: { type: "string", example: "Clean Code" },
          author: { type: "string", example: "Robert C. Martin" },
          stock: { type: "integer", example: 5 }
        }
      },
      CreateBookRequest: {
        type: "object",
        required: ["id", "title", "author", "stock"],
        properties: {
          id: { type: "integer", example: 105 },
          title: { type: "string", example: "Patterns of Enterprise Application Architecture" },
          author: { type: "string", example: "Martin Fowler" },
          stock: { type: "integer", example: 6 }
        }
      },
      UpdateStockRequest: {
        type: "object",
        properties: {
          stock: { type: "integer", example: 4, description: "Set absolute stock value." },
          delta: { type: "integer", example: -1, description: "Increment or decrement stock." }
        }
      }
    },
    paths: {
      "/api/books": {
        get: {
          summary: "List books",
          responses: {
            200: jsonResponse("Books in BookDB", {
              type: "array",
              items: { $ref: "#/components/schemas/Book" }
            })
          }
        },
        post: {
          summary: "Create a book",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateBookRequest" }
              }
            }
          },
          responses: {
            201: jsonResponse("Created book", { $ref: "#/components/schemas/Book" }),
            400: jsonResponse("Invalid input", { $ref: "#/components/schemas/ErrorResponse" }),
            409: jsonResponse("Duplicate book", { $ref: "#/components/schemas/ErrorResponse" })
          }
        }
      },
      "/api/books/{id}": {
        get: {
          summary: "Get a book by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            200: jsonResponse("Book found", { $ref: "#/components/schemas/Book" }),
            404: jsonResponse("Book not found", { $ref: "#/components/schemas/ErrorResponse" })
          }
        }
      },
      "/api/books/{id}/stock": {
        put: {
          summary: "Update book stock after borrowing or returning",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateStockRequest" },
                examples: {
                  borrow: { value: { delta: -1 } },
                  return: { value: { delta: 1 } },
                  set: { value: { stock: 8 } }
                }
              }
            }
          },
          responses: {
            200: jsonResponse("Updated book", { $ref: "#/components/schemas/Book" }),
            400: jsonResponse("Invalid input", { $ref: "#/components/schemas/ErrorResponse" }),
            404: jsonResponse("Book not found", { $ref: "#/components/schemas/ErrorResponse" }),
            409: jsonResponse("Stock would be negative", { $ref: "#/components/schemas/ErrorResponse" })
          }
        }
      }
    }
  });
}

module.exports = app;
