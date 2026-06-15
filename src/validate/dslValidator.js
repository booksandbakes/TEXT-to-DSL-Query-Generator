import { z } from "zod";

const generatedQuerySchema = z
  .object({
    query: z.record(z.unknown()),
    sort: z.array(z.unknown()).optional(),
    aggs: z.record(z.unknown()).optional(),
    _source: z.union([z.boolean(), z.array(z.string())]).optional(),
    size: z.number().int().nonnegative().max(10_000).optional(),
    from: z.number().int().nonnegative().optional(),
    search_after: z.array(z.unknown()).optional(),
    explanation: z.string().optional(),
  })
  .strict();

export function parseGeneratedQuery(raw) {
  const parsed = generatedQuerySchema.parse(raw);
  const { explanation, ...body } = parsed;
  return { body, explanation };
}

export function extractJsonFromText(text) {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim());
    }

    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }

    throw new Error("Model response did not contain valid JSON");
  }
}
