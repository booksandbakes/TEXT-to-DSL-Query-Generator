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
    const keywordSubfield =
      type === "text" && getObject(subfields?.keyword) ? `${path}.keyword` : undefined;

    fields.push({
      path,
      type,
      searchable: SEARCHABLE_TYPES.has(type),
      aggregatable: AGGREGATABLE_TYPES.has(type) || Boolean(keywordSubfield),
      keywordSubfield,
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

export function normalizeMapping(index, mapping) {
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
      });
    }
  }

  return {
    index,
    fields: [...fieldMap.values()].sort((a, b) => a.path.localeCompare(b.path)),
    fieldMap,
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
      if (field.format) {
        parts.push(`format: ${field.format}`);
      }
      return parts.join(", ");
    });

  return [`Index: ${schema.index}`, "Fields:", ...lines].join("\n");
}
