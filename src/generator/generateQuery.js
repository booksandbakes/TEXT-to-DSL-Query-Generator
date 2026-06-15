import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, buildUserPrompt } from "../prompt/buildPrompt.js";
import { extractJsonFromText, parseGeneratedQuery } from "../validate/dslValidator.js";

export class QueryGenerator {
  constructor(config = {}) {
    const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Missing Anthropic API key. Set ANTHROPIC_API_KEY or pass llm.apiKey.");
    }

    this.client = new Anthropic({
      apiKey,
      baseURL: config.baseURL,
    });
    this.model = config.model ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
  }

  async generate(input) {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: buildSystemPrompt(),
      messages: [
        {
          role: "user",
          content: buildUserPrompt(
            input.schema,
            input.question,
            input.defaultSize,
            input.previousErrors,
          ),
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("LLM declined to generate a query for this request");
    }

    const content = response.content.find((block) => block.type === "text")?.text;
    if (!content) {
      throw new Error("LLM returned an empty response");
    }

    const raw = extractJsonFromText(content);
    const { body, explanation } = parseGeneratedQuery(raw);

    if (body.size === undefined) {
      body.size = input.defaultSize;
    }

    return { body, explanation };
  }
}
