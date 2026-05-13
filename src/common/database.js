const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function dataDirectory() {
  const directory = process.env.DATA_DIR || path.join(process.cwd(), "data");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function openDatabase(fileName) {
  const dbPath = path.isAbsolute(fileName)
    ? fileName
    : path.join(dataDirectory(), fileName);
  const database = new DatabaseSync(dbPath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
  `);
  return database;
}

function ensureSeeded(database, tableName, seedRows) {
  const row = database
    .prepare(`SELECT COUNT(*) AS total FROM ${tableName}`)
    .get();

  if (row.total === 0) {
    const insert = database.prepare(seedRows.sql);
    database.exec("BEGIN TRANSACTION");
    try {
      for (const params of seedRows.values) {
        insert.run(...params);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

module.exports = {
  openDatabase,
  ensureSeeded
};
