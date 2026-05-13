# Digital Library System

This folder implements the service-based architecture exercise from `Service-based arch-ex 2 (1).pdf`.

It uses four independent services, one database per service, HTTP calls between services, Swagger docs, a single gateway on port `8000`, and a small frontend for the bonus UI flow. SQL Server was replaced with local SQLite files created automatically in `data/`, so there is no database server to install or configure.

## Architecture

| Service | Port | Database | Responsibility |
| --- | ---: | --- | --- |
| Identity Service | `5001` | `data/identity.sqlite` | Readers, ranks, borrowing limits |
| Book Service | `5002` | `data/book.sqlite` | Books, authors, stock updates |
| Borrowing Service | `5003` | `data/borrowing.sqlite` | Borrow/return workflow and cross-service checks |
| Notification Service | `5004` | `data/notification.sqlite` | Simulated notification logs |
| Gateway | `8000` | none | Single entry point that proxies to services |
| Frontend | `3001` | none | Lists books and borrows through the gateway |

## Run

```bash
npm install
npm start
```

Open:

- Frontend: http://localhost:3001
- Gateway Swagger: http://localhost:8000/swagger
- Identity Swagger: http://localhost:5001/swagger
- Book Swagger: http://localhost:5002/swagger
- Borrowing Swagger: http://localhost:5003/swagger
- Notification Swagger: http://localhost:5004/swagger

## Verify

```bash
npm run smoke
```

The smoke test starts all services on temporary ports, checks seeded data, borrows books through the gateway, verifies the Silver rank limit of 3 active borrows, verifies stock decrement, checks notification logs, checks Swagger JSON, and confirms the frontend serves.

## PDF Requirements Covered

- Four independent services: Identity, Book, Borrowing, Notification.
- Four independent local databases: one SQLite file per service.
- Borrowing workflow uses HTTP calls between services and never joins across databases.
- Book Service exposes stock update API.
- Identity Service exposes rank and borrowing limit API.
- Borrowing Service handles dead/unavailable dependencies with controlled error responses.
- Swagger/OpenAPI is available for all four services.
- Gateway runs on port `8000` as the single API entry point.
- Bonus frontend lists books and lets a selected reader borrow through the gateway.

## Main API Flow

Borrow a book through the gateway:

```bash
curl -X POST http://localhost:8000/api/borrow \
  -H "Content-Type: application/json" \
  -d '{"userId": 1, "bookId": 101}'
```

During that request, Borrowing Service:

1. Calls Identity Service to verify the reader exists and read the rank limit.
2. Calls Book Service to verify the book exists and has stock.
3. Saves the borrow record in its own SQLite database.
4. Calls Book Service to decrement stock by `1`.
5. Calls Notification Service to write a simulated notification log.

Return a book:

```bash
curl -X PUT http://localhost:8000/api/borrow/1/return \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Seed Data

Identity:

- `1`, `sv01`, `Nguyen Van A`, `Gold`
- `2`, `sv02`, `Tran Thi B`, `Silver`

Books:

- `101`, `Clean Code`, `Robert C. Martin`, stock `5`
- `102`, `Design Patterns`, `Gang of Four`, stock `2`
- `103`, `Refactoring`, `Martin Fowler`, stock `4`
- `104`, `Domain-Driven Design`, `Eric Evans`, stock `3`

## Notes

- Each service only reads/writes its own SQLite database.
- Services communicate only through HTTP, not shared database joins.
- If a dependency service is unavailable, Borrowing Service returns a controlled `503` response instead of crashing.
- SQLite support uses Node.js `node:sqlite`, so Node `24+` is required.
