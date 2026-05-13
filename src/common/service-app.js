const cors = require("cors");
const express = require("express");

function createServiceApp(serviceName) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: "*" }));
  app.use(express.json());

  app.get("/health", (req, res) => {
    res.json({
      service: serviceName,
      status: "ok",
      time: new Date().toISOString()
    });
  });

  return app;
}

function sendNotFound(app) {
  app.use((req, res) => {
    res.status(404).json({
      message: "Route not found",
      path: req.originalUrl
    });
  });
}

function sendErrors(app) {
  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    res.status(error.status || 500).json({
      message: error.message || "Unexpected server error"
    });
  });
}

function listen(app, port, serviceName) {
  return app.listen(port, () => {
    console.log(`${serviceName} running at http://localhost:${port}`);
    console.log(`${serviceName} Swagger at http://localhost:${port}/swagger`);
  });
}

module.exports = {
  createServiceApp,
  sendNotFound,
  sendErrors,
  listen
};
