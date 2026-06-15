// Lightweight validation: we only check that every field the query references
// actually exists in the mapping (and is usable). Query *structure* is left to
// Elasticsearch — whitelisting query types just causes false rejects and adds
// nothing here, since this tool generates queries rather than executing them.
//
// Everything is a single recursive pass with O(1) Set/Map lookups.

// Leaf queries shaped as `{ <queryType>: { <fieldName>: <value> } }` — the
// immediate child key IS the field name (term, match, range, ...). Other query
// types (multi_match, query_string, geo_*, ...) reference fields through
// `field` / `fields` / `default_field` keys, handled below.
const FIELD_KEYED_QUERY_TYPES = new Set([
  "term",
  "terms",
  "terms_set",
  "match",
  "match_phrase",
  "match_phrase_prefix",
  "match_bool_prefix",
  "prefix",
  "wildcard",
  "regexp",
  "fuzzy",
  "range",
]);

// Single pass over the query: collect every field it references.
function collectQueryFields(value, fields) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectQueryFields(item, fields);
    }
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (FIELD_KEYED_QUERY_TYPES.has(key) && nested && typeof nested === "object") {
      for (const fieldName of Object.keys(nested)) {
        fields.add(fieldName);
      }
    } else if ((key === "field" || key === "default_field") && typeof nested === "string") {
      fields.add(nested);
    } else if (key === "fields" && Array.isArray(nested)) {
      for (const fieldName of nested) {
        if (typeof fieldName === "string") {
          fields.add(fieldName.split("^")[0]); // strip per-field boost ("name^3")
        }
      }
    }

    collectQueryFields(nested, fields);
  }
}

// Aggregations reference fields only via `field` / `fields`. Agg types
// (terms, range) share names with query types, so we must NOT treat their
// option keys as fields — collect `field`/`fields` only.
function collectAggregationFields(value, fields) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectAggregationFields(item, fields);
    }
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (key === "field" && typeof nested === "string") {
      fields.add(nested);
    } else if (key === "fields" && Array.isArray(nested)) {
      for (const fieldName of nested) {
        if (typeof fieldName === "string") {
          fields.add(fieldName);
        }
      }
    } else {
      collectAggregationFields(nested, fields);
    }
  }
}

// sort: string | { field: order } | { field: { order, ... } } | array of those.
// Keys starting with "_" are special (_score, _doc, _geo_distance) — skip them.
function collectSortFields(sort, fields) {
  const entries = Array.isArray(sort) ? sort : [sort];
  for (const entry of entries) {
    if (typeof entry === "string") {
      if (!entry.startsWith("_")) fields.add(entry);
    } else if (entry && typeof entry === "object") {
      for (const key of Object.keys(entry)) {
        if (!key.startsWith("_")) fields.add(key);
      }
    }
  }
}

// _source: array of patterns or { includes, excludes }. Skip wildcards.
function collectSourceFields(source, fields) {
  const add = (list) => {
    if (!Array.isArray(list)) return;
    for (const name of list) {
      if (typeof name === "string" && !name.includes("*")) fields.add(name);
    }
  };
  if (Array.isArray(source)) {
    add(source);
  } else if (source && typeof source === "object") {
    add(source.includes);
    add(source.excludes);
  }
}

export function validateQueryAgainstMapping(body, schema) {
  const errors = [];
  const usedFields = new Set();
  const aggFields = new Set();

  if (!body.query || typeof body.query !== "object" || Array.isArray(body.query)) {
    errors.push("Generated body is missing a valid query");
    return { ok: false, errors, usedFields: [] };
  }

  collectQueryFields(body.query, usedFields);
  if (body.sort) collectSortFields(body.sort, usedFields);
  if (body._source !== undefined) collectSourceFields(body._source, usedFields);
  if (body.aggs) collectAggregationFields(body.aggs, aggFields);

  for (const fieldName of usedFields) {
    const field = schema.fieldMap.get(fieldName);
    if (!field) {
      errors.push(`Unknown field referenced in query: ${fieldName}`);
    } else if (!field.searchable && !field.aggregatable) {
      errors.push(`Field is not searchable: ${fieldName}`);
    }
  }

  for (const fieldName of aggFields) {
    const field = schema.fieldMap.get(fieldName);
    if (!field) {
      errors.push(`Unknown aggregation field: ${fieldName}`);
    } else if (!field.aggregatable && !field.keywordSubfield) {
      errors.push(`Field is not aggregatable: ${fieldName}`);
    } else {
      usedFields.add(fieldName);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    usedFields: [...usedFields].sort(),
  };
}
