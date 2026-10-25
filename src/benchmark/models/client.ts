import { ModelFamily, ModelGenerationResult, ModelPromptPayload } from "./types.js";

export class LiveNvidiaModelClient {
  private readonly endpoint: string;
  private readonly apiKey?: string;

  constructor(
    endpoint = "https://integrate.api.nvidia.com/v1/chat/completions",
    apiKey = process.env.NVIDIA_API_KEY
  ) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
  }

  hasApiKey(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 0);
  }

  async generatePlan(
    modelId: string,
    payload: ModelPromptPayload
  ): Promise<ModelGenerationResult> {
    if (!this.hasApiKey()) {
      throw new Error("NVIDIA_API_KEY environment variable is not set");
    }

    const toolSummary = payload.availableTools
      .map((t) => `- ${t.name} (${t.type}): ${t.description ?? "N/A"}`)
      .join("\n");

    const systemPrompt = `You are an AI planner for Project X.
Given the task and tool capabilities, you must generate a declarative ExecutionPlan in YAML conforming to:
\`\`\`yaml
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: <string>
spec:
  limits:
    maxSteps: 5
    timeoutMs: 15000
    maxResultBytes: 25000
  permissions: []
  steps:
    - id: <step_id>
      tool: <tool_name>
      dependsOn: []
      arguments:
        <argKey>: <argValue>
  output:
    include:
      - <step_id>
\`\`\`
CRITICAL SCHEMA RULES:
1. "output" belongs under "spec", NOT inside "steps".
2. Every step must have "id", "tool", and "arguments".

Output ONLY the raw YAML within a \`\`\`yaml codeblock.`;

    const userPrompt = `Task: ${payload.taskDescription}

Available Tools:
${toolSummary}

Emit the ExecutionPlan:`;

    const startTime = performance.now();

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`NVIDIA API call failed (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const durationMs = Math.round(performance.now() - startTime);
    const rawContent = data.choices[0]?.message.content ?? "";
    const inputTokens = data.usage?.prompt_tokens ?? 350;
    const outputTokens = data.usage?.completion_tokens ?? 120;

    let parsedPlanYaml: string | undefined;
    let parseError: string | undefined;

    const yamlBlockMatch = rawContent.match(/```(?:yaml)?\n([\s\S]*?)\n```/);
    if (yamlBlockMatch && yamlBlockMatch[1]) {
      parsedPlanYaml = yamlBlockMatch[1].trim();
    } else if (rawContent.includes("apiVersion: x.dev/v1alpha1")) {
      parsedPlanYaml = rawContent.trim();
    } else {
      parseError = "Model failed to output a ```yaml block";
    }

    return {
      modelId,
      inputTokens,
      outputTokens,
      durationMs,
      rawResponse: rawContent,
      parsedPlanYaml,
      parseError,
    };
  }

  async generateCodeModeScript(
    modelId: string,
    payload: ModelPromptPayload
  ): Promise<ModelGenerationResult> {
    if (!this.hasApiKey()) {
      throw new Error("NVIDIA_API_KEY environment variable is not set");
    }

    const toolSummary = payload.availableTools
      .map((t) => `- ${t.name} (${t.type})`)
      .join("\n");

    const systemPrompt = `You write sandboxed JavaScript code executing multi-step tasks.
You can call: await invokeTool(toolName, args);
And: setOutput(result);
Output ONLY the raw JavaScript within a \`\`\`javascript codeblock.`;

    const userPrompt = `Task: ${payload.taskDescription}
Tools:
${toolSummary}
Write script:`;

    const startTime = performance.now();

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`NVIDIA API call failed (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const durationMs = Math.round(performance.now() - startTime);
    const rawContent = data.choices[0]?.message.content ?? "";
    const inputTokens = data.usage?.prompt_tokens ?? 250;
    const outputTokens = data.usage?.completion_tokens ?? 90;

    let parsedCodeScript: string | undefined;
    let parseError: string | undefined;

    const jsBlockMatch = rawContent.match(/```(?:javascript|js)?\n([\s\S]*?)\n```/);
    if (jsBlockMatch && jsBlockMatch[1]) {
      parsedCodeScript = jsBlockMatch[1].trim();
    } else if (rawContent.includes("invokeTool")) {
      parsedCodeScript = rawContent.trim();
    } else {
      parseError = "Model failed to output a ```javascript block";
    }

    return {
      modelId,
      inputTokens,
      outputTokens,
      durationMs,
      rawResponse: rawContent,
      parsedCodeScript,
      parseError,
    };
  }
}
