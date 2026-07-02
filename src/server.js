const config = require("./config");
const { closePool } = require("./db");
const { createApp } = require("./app");

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  console.log(`API listening on http://${config.host}:${config.port}`);
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down.`);

  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
