import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { HttpError } from "./errors.js";
import {
  askHandler,
  deleteMappingHandler,
  getSchemaHandler,
  healthHandler,
  listMappingsHandler,
  putMappingHandler,
} from "./handlers.js";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

export function createServer() {
  const app = express();
  app.set("json spaces", 2);

  // Parse JSON bodies (1 MB cap, matching the previous raw-http limit).
  app.use(express.json({ limit: "1mb" }));

  // Serve the dashboard (public/index.html) at "/".
  app.use(express.static(publicDir));

  app.get("/health", healthHandler);
  app.get("/mappings", listMappingsHandler);
  app.get("/mappings/:index/schema", getSchemaHandler);
  app.put("/mappings/:index", putMappingHandler);
  app.delete("/mappings/:index", deleteMappingHandler);
  app.post("/ask", askHandler);

  // 404 for anything unmatched.
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Centralised error handling.
  app.use((error, _req, res, _next) => {
    if (error instanceof HttpError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    if (error?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: "Request body too large" });
      return;
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(500).json({ error: message });
  });

  return app;
}
