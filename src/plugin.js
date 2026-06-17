import { QueryGenerator } from "./generator/generateQuery.js";
import { normalizeMapping } from "./mapping/normalize.js";
import { validateQueryAgainstMapping } from "./validate/mappingValidator.js";

export class TextToESPlugin {
  constructor(options = {}) {
    this.llmConfig = options.llm;
    this.generator = undefined;
    this.maxRetries = options.maxRetries ?? 2;
    this.defaultSize = options.defaultSize ?? 100;
    this.schemas = new Map();
    this.raw = new Map();
  }

  rebuild(index) {
    const { mapping, settings } = this.raw.get(index);
    this.schemas.set(index, normalizeMapping(index, mapping, settings));
  }

  getGenerator() {
    if (!this.generator) {
      this.generator = new QueryGenerator(this.llmConfig);
    }
    return this.generator;
  }

  setMapping(index, mapping) {
    const existing = this.raw.get(index);
    this.raw.set(index, { mapping, settings: existing?.settings });
    this.rebuild(index);
  }

  setSettings(index, settings) {
    const existing = this.raw.get(index);
    if (!existing) {
      throw new Error(`No mapping registered for index "${index}". Register a mapping first.`);
    }
    this.raw.set(index, { ...existing, settings });
    this.rebuild(index);
  }

  hasMapping(index) {
    return this.raw.has(index);
  }

  deleteMapping(index) {
    this.raw.delete(index);
    return this.schemas.delete(index);
  }

  getSchema(index) {
    const schema = this.schemas.get(index);
    if (!schema) {
      throw new Error(`No mapping registered for index "${index}". Call setMapping() first.`);
    }
    return schema;
  }

  listIndices() {
    return [...this.schemas.keys()].sort();
  }

  async ask(options) {
    const schema = this.getSchema(options.index);
    const size = options.size ?? this.defaultSize;
    const maxAttempts = this.maxRetries + 1;

    let lastErrors;
    let lastExplanation;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const generated = await this.getGenerator().generate({
        schema,
        question: options.question,
        defaultSize: size,
        previousErrors: lastErrors,
      });

      lastExplanation = generated.explanation;

      const validation = validateQueryAgainstMapping(generated.body, schema);
      if (validation.ok) {
        return {
          query: generated.body,
          explanation: lastExplanation,
          usedFields: validation.usedFields,
          attempts: attempt,
        };
      }

      lastErrors = validation.errors;
    }

    throw new Error(
      `Could not generate a valid Elasticsearch query after ${maxAttempts} attempts:\n${(lastErrors ?? []).join("\n")}`,
    );
  }
}

export function serializeSchema(schema) {
  return {
    index: schema.index,
    fields: schema.fields,
    fieldMap: Object.fromEntries(schema.fieldMap),
    analysis: schema.analysis,
  };
}
