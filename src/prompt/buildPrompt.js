import { schemaToPrompt } from "../mapping/normalize.js";

const FEW_SHOT_EXAMPLES = [
  {
    question: "Show cancelled orders from the last 7 days",
    query: {
      query: {
        bool: {
          filter: [
            { term: { "status.keyword": "cancelled" } },
            { range: { created_at: { gte: "now-7d/d" } } },
          ],
        },
      },
      sort: [{ created_at: "desc" }],
      size: 100,
    },
  },
  {
    question: "Find customers named John Smith",
    query: {
      query: {
        match_phrase: {
          "customer.name": "John Smith",
        },
      },
      size: 50,
    },
  },
  {
    question: "Count orders grouped by status",
    query: {
      query: { match_all: {} },
      size: 0,
      aggs: {
        by_status: {
          terms: { field: "status.keyword", size: 20 },
        },
      },
    },
  },
];

export function buildSystemPrompt() {
  return [
    "You convert natural language questions into Elasticsearch Query DSL.",
    "Return JSON only with keys: query (required), sort, aggs, _source, size, from, search_after, explanation.",
    "Rules:",
    "- Use only fields from the provided schema.",
    "- Use term/terms for keyword fields; use match/match_phrase for analyzed text fields.",
    "- Prefer .keyword subfields for exact filters, sorting, and aggregations.",
    "- Use range queries for numeric and date fields.",
    "- Wrap clauses on nested fields inside a nested query with the correct path.",
    "- Use bool.filter for exact constraints and bool.must for full-text relevance.",
    "- For full-text/multi_match/match queries use the analyzed field name (e.g. source), never its .keyword subfield; reserve .keyword for term/terms, sorting, and aggregations.",
    "- Respect each field's analyzer/normalizer shown in the schema: when a keyword field has a normalizer with a lowercase filter, lowercase the value in term/terms queries so it matches; match query text to the field's analyzer behaviour.",
    "- Never generate update/delete/index operations or scripts.",
    "- Default size to the requested value unless the user asks for counts/aggregations (then size can be 0).",
    "- For pagination use from + size (offset paging); for deep pagination use search_after together with a sort.",
  ].join("\n");
}

export function buildUserPrompt(schema, question, defaultSize, previousErrors) {
  const examples = FEW_SHOT_EXAMPLES.map(
    (example) =>
      `Question: ${example.question}\nResponse: ${JSON.stringify({ ...example.query, explanation: "Example query" })}`,
  ).join("\n\n");

  const errorSection =
    previousErrors && previousErrors.length > 0
      ? `\nPrevious attempt failed validation:\n${previousErrors.map((error) => `- ${error}`).join("\n")}\nFix these issues.\n`
      : "";

  return [
    schemaToPrompt(schema),
    "",
    "Examples:",
    examples,
    "",
    errorSection,
    `Question: ${question}`,
    `Default size: ${defaultSize}`,
    "Return a single JSON object.",
  ].join("\n");
}
