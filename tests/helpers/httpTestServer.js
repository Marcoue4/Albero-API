const http = require("node:http");
const { once } = require("node:events");
const { closePool } = require("../../src/db");

async function createHttpTestServer(app) {
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      await closePool();
    },
  };
}

module.exports = {
  createHttpTestServer,
};
