import { ModelFamily } from "./types.js";

export const CLAUDE_35_SONNET: ModelFamily = {
  id: "claude-3-5-sonnet",
  name: "Claude 3.5 Sonnet",
  family: "anthropic",
  pricing: {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
  },
  promptStyle: "xml_tagged",
  firstAttemptPlanSuccessRate: 0.96,
  codeModeErrorRate: 0.05,
};

export const GPT_4O: ModelFamily = {
  id: "gpt-4o",
  name: "GPT-4o",
  family: "openai",
  pricing: {
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
  },
  promptStyle: "markdown_json",
  firstAttemptPlanSuccessRate: 0.91,
  codeModeErrorRate: 0.04,
};

export const BENCHMARK_MODEL_FAMILIES: readonly ModelFamily[] = [
  CLAUDE_35_SONNET,
  GPT_4O,
];
