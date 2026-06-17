import { config } from "../config.js";
import { TextToESPlugin, serializeSchema } from "../plugin.js";
import { HttpError } from "./errors.js";

const plugin = new TextToESPlugin({
  llm: {
    apiKey: config.anthropic.apiKey,
    model: config.anthropic.model,
    baseURL: config.anthropic.baseURL,
  },
});

function ensureObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${label} must be a JSON object`);
  }
  return value;
}

function ensureString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${label} must be a non-empty string`);
  }
  return value.trim();
}

export async function healthHandler(_req, res) {
  res.json({
    status: "ok",
    service: "text-es",
    indices: plugin.listIndices(),
  });
}

export async function listMappingsHandler(_req, res) {
  res.json({ indices: plugin.listIndices() });
}

export async function getSchemaHandler(req, res) {
  const schema = plugin.getSchema(req.params.index);
  res.json(serializeSchema(schema));
}

export async function putMappingHandler(req, res) {
  const mapping = ensureObject(req.body, "mapping");
  plugin.setMapping(req.params.index, mapping);
  res.json({
    index: req.params.index,
    message: "Mapping registered",
    fieldCount: plugin.getSchema(req.params.index).fields.length,
  });
}

export async function putSettingsHandler(req, res) {
  const settings = ensureObject(req.body, "settings");
  if (!plugin.hasMapping(req.params.index)) {
    throw new HttpError(404, `Register a mapping for "${req.params.index}" before adding settings`);
  }
  plugin.setSettings(req.params.index, settings);
  const { analysis } = plugin.getSchema(req.params.index);
  res.json({
    index: req.params.index,
    message: "Settings registered",
    analyzerCount: analysis?.analyzers.length ?? 0,
    normalizerCount: analysis?.normalizers.length ?? 0,
  });
}

export async function deleteMappingHandler(req, res) {
  const removed = plugin.deleteMapping(req.params.index);
  if (!removed) {
    throw new HttpError(404, `No mapping registered for index "${req.params.index}"`);
  }
  res.status(204).end();
}

export async function askHandler(req, res) {
  const payload = ensureObject(req.body, "body");
  const index = ensureString(payload.index, "index");
  const question = ensureString(payload.question, "question");
  const size = typeof payload.size === "number" ? payload.size : undefined;

  console.log(`[ask] index="${index}" question="${question}"${size ? ` size=${size}` : ""}`);

  try {
    const result = await plugin.ask({ index, question, size });
    console.log(
      `[ask] ok index="${index}" attempts=${result.attempts} usedFields=${result.usedFields.length}`,
    );
    res.json(result);
  } catch (error) {
    console.error(`[ask] failed index="${index}": ${error.message}`);
    throw error;
  }
}
