const AGGREGATABLE_TYPES = new Set([
  "keyword",
  "long",
  "integer",
  "short",
  "byte",
  "double",
  "float",
  "half_float",
  "scaled_float",
  "boolean",
  "date",
  "date_nanos",
  "ip",
]);

const SEARCHABLE_TYPES = new Set([
  ...AGGREGATABLE_TYPES,
  "text",
  "match_only_text",
  "wildcard",
  "constant_keyword",
]);

function getString(value) {
  return typeof value === "string" ? value : undefined;
}

function getObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function walkMapping(mapping, context, fields) {
  const properties = getObject(mapping.properties) ?? mapping;

  for (const [name, rawField] of Object.entries(properties)) {
    const field = getObject(rawField);
    if (!field) {
      continue;
    }

    const path = context.prefix ? `${context.prefix}.${name}` : name;
    const type = getString(field.type);

    if (type === "object" || (!type && getObject(field.properties))) {
      walkMapping(field, { ...context, prefix: path }, fields);
      continue;
    }

    if (type === "nested") {
      walkMapping(field, { prefix: path, nestedPath: path }, fields);
      continue;
    }

    if (!type) {
      continue;
    }

    const subfields = getObject(field.fields);
    const keywordSubfieldDef = type === "text" ? getObject(subfields?.keyword) : undefined;
    const keywordSubfield = keywordSubfieldDef ? `${path}.keyword` : undefined;

    fields.push({
      path,
      type,
      searchable: SEARCHABLE_TYPES.has(type),
      aggregatable: AGGREGATABLE_TYPES.has(type) || Boolean(keywordSubfield),
      keywordSubfield,
      keywordSubfieldNormalizer: getString(keywordSubfieldDef?.normalizer),
      analyzer: getString(field.analyzer),
      searchAnalyzer: getString(field.search_analyzer),
      normalizer: getString(field.normalizer),
      format: getString(field.format),
      nestedPath: context.nestedPath,
    });
  }
}

function unwrapIndexMapping(mapping) {
  const mappings = getObject(mapping.mappings);
  if (mappings) {
    return mappings;
  }

  const firstIndex = Object.values(mapping).find((value) => getObject(value)?.mappings);
  const nestedMappings = getObject(firstIndex)?.mappings;
  if (getObject(nestedMappings)) {
    return nestedMappings;
  }

  return mapping;
}

// Index settings can arrive in several shapes: the raw analysis block, a
// `{ settings: { analysis } }` wrapper, the `GET /index` form
// (`{ settings: { index: { analysis } } }`), or a full index envelope keyed by
// index name. Find the analysis block wherever it lives.
function extractAnalysis(settings) {
  const root = getObject(settings);
  if (!root) {
    return undefined;
  }

  const candidates = [root, getObject(root.settings), getObject(root.settings?.index), getObject(root.index)];

  const firstIndexSettings = getObject(Object.values(root).find((value) => getObject(value)?.settings))?.settings;
  if (getObject(firstIndexSettings)) {
    candidates.push(firstIndexSettings, getObject(firstIndexSettings.index));
  }

  for (const candidate of candidates) {
    const analysis = getObject(candidate?.analysis);
    if (analysis) {
      return analysis;
    }
  }

  return undefined;
}

function summarizeAnalysisGroup(analysis, group) {
  return Object.entries(getObject(analysis[group]) ?? {})
    .map(([name, raw]) => {
      const def = getObject(raw) ?? {};
      const filters = Array.isArray(def.filter)
        ? def.filter.filter((entry) => typeof entry === "string")
        : undefined;
      return {
        name,
        tokenizer: getString(def.tokenizer),
        filters: filters?.length ? filters : undefined,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function summarizeAnalysis(settings) {
  const analysis = extractAnalysis(settings);
  if (!analysis) {
    return undefined;
  }

  const analyzers = summarizeAnalysisGroup(analysis, "analyzer");
  const normalizers = summarizeAnalysisGroup(analysis, "normalizer");
  if (!analyzers.length && !normalizers.length) {
    return undefined;
  }

  return { analyzers, normalizers };
}

export function normalizeMapping(index, mapping, settings) {
  const root = unwrapIndexMapping(mapping);
  const fields = [];

  walkMapping(root, { prefix: "" }, fields);

  const fieldMap = new Map(fields.map((field) => [field.path, field]));

  for (const field of fields) {
    if (field.keywordSubfield) {
      fieldMap.set(field.keywordSubfield, {
        ...field,
        path: field.keywordSubfield,
        type: "keyword",
        searchable: true,
        aggregatable: true,
        keywordSubfield: undefined,
        analyzer: undefined,
        searchAnalyzer: undefined,
        normalizer: field.keywordSubfieldNormalizer,
        keywordSubfieldNormalizer: undefined,
      });
    }
  }

  return {
    index,
    fields: [...fieldMap.values()].sort((a, b) => a.path.localeCompare(b.path)),
    fieldMap,
    analysis: summarizeAnalysis(settings),
  };
}

export function schemaToPrompt(schema) {
  const lines = schema.fields
    .filter((field) => field.searchable || field.aggregatable)
    .map((field) => {
      const parts = [`- ${field.path} (${field.type})`];
      if (field.keywordSubfield) {
        parts.push(`keyword: ${field.keywordSubfield}`);
      }
      if (field.nestedPath) {
        parts.push(`nested under: ${field.nestedPath}`);
      }
      if (field.analyzer) {
        parts.push(`analyzer: ${field.analyzer}`);
      }
      if (field.searchAnalyzer) {
        parts.push(`search_analyzer: ${field.searchAnalyzer}`);
      }
      if (field.normalizer) {
        parts.push(`normalizer: ${field.normalizer}`);
      }
      if (field.format) {
        parts.push(`format: ${field.format}`);
      }
      return parts.join(", ");
    });

  const sections = [`Index: ${schema.index}`, "Fields:", ...lines];

  if (schema.analysis) {
    const analysisLines = [];
    if (schema.analysis.analyzers.length) {
      analysisLines.push("Custom analyzers:");
      for (const analyzer of schema.analysis.analyzers) {
        const detail = [
          analyzer.tokenizer ? `tokenizer: ${analyzer.tokenizer}` : undefined,
          analyzer.filters ? `filters: ${analyzer.filters.join(", ")}` : undefined,
        ].filter(Boolean);
        analysisLines.push(`- ${analyzer.name}${detail.length ? ` (${detail.join("; ")})` : ""}`);
      }
    }
    if (schema.analysis.normalizers.length) {
      analysisLines.push("Normalizers (applied to keyword fields):");
      for (const normalizer of schema.analysis.normalizers) {
        const filters = normalizer.filters ? ` (filters: ${normalizer.filters.join(", ")})` : "";
        analysisLines.push(`- ${normalizer.name}${filters}`);
      }
    }
    sections.push("", "Analysis settings:", ...analysisLines);
  }

  return sections.join("\n");
}
