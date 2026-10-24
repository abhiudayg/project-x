export interface ModelFamily {
  readonly id: string;
  readonly name: string;
  readonly family: "anthropic" | "openai" | "google";
  readonly pricing: {
    readonly inputPerMillion: number;
    readonly outputPerMillion: number;
  };
  readonly promptStyle: "xml_tagged" | "markdown_json" | "direct";
  readonly firstAttemptPlanSuccessRate: number; // Inherent empirical error rate
  readonly codeModeErrorRate: number;
}

export interface ModelPromptPayload {
  readonly taskDescription: string;
  readonly availableTools: readonly {
    readonly name: string;
    readonly description?: string;
    readonly type: "read" | "write";
  }[];
  readonly systemPrompt: string;
}

export interface ModelGenerationResult {
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
  readonly rawResponse: string;
  readonly parsedPlanYaml?: string;
  readonly parsedCodeScript?: string;
  readonly parseError?: string;
}
