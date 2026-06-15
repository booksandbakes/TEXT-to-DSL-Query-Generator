import { config } from "./config.js";
import { createServer } from "./http/createServer.js";

const server = createServer();

server.listen(config.port, config.host, () => {
  console.log(`TEXT-DSL Query server listening on http://${config.host}:${config.port}`);
  console.log("Endpoints:");
  console.log("  GET  /health");
  console.log("  GET  /mappings");
  console.log("  PUT  /mappings/:index");
  console.log("  GET  /mappings/:index/schema");
  console.log("  DELETE /mappings/:index");
  console.log("  POST /ask");
});
