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
  }

  getGenerator() {
    if (!this.generator) {
      this.generator = new QueryGenerator(this.llmConfig);
    }
    return this.generator;
  }

  setMapping(index, mapping) {
    this.schemas.set(index, normalizeMapping(index, mapping));
  }

  deleteMapping(index) {
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
  };
}
