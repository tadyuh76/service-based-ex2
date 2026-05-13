const path = require("node:path");
const express = require("express");

const SERVICE_NAME = "Frontend";
const PORT = Number(process.env.PORT || 3001);
const app = express();

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({
    service: SERVICE_NAME,
    status: "ok",
    time: new Date().toISOString()
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`${SERVICE_NAME} running at http://localhost:${PORT}`);
  });
}

module.exports = app;
