import { ToolAdapter, ToolCapability } from "./types.js";

export interface MCPClientLike {
  listTools(): Promise<{
    tools: Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }>;
  }>;
  callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<{
    content: Array<{ type: string; text?: string; data?: string }>;
    isError?: boolean;
  }>;
}

export class MCPAdapter implements ToolAdapter {
  private toolCache?: readonly ToolCapability[];

  constructor(
    private readonly client: MCPClientLike,
    private readonly toolClassifications: Record<string, "read" | "write"> = {},
    private readonly verificationDeclarations: Record<string, string> = {}
  ) {}

  async listTools(): Promise<readonly ToolCapability[]> {
    if (this.toolCache) {
      return this.toolCache;
    }

    const res = await this.client.listTools();
    const capabilities: ToolCapability[] = res.tools.map((t) => {
      const type = this.toolClassifications[t.name] ?? "read";
      const verificationTool = this.verificationDeclarations[t.name];
      return {
        name: t.name,
        description: t.description,
        type,
        verificationTool,
      };
    });

    this.toolCache = capabilities;
    return capabilities;
  }

  async getTool(name: string): Promise<ToolCapability | undefined> {
    const tools = await this.listTools();
    return tools.find((t) => t.name === name);
  }

  async execute(
    tool: string,
    args: Record<string, unknown>,
    _options?: {
      signal?: AbortSignal;
      idempotencyKey?: string;
      callerIdentity?: string;
    }
  ): Promise<unknown> {
    const res = await this.client.callTool({
      name: tool,
      arguments: args,
    });

    if (res.isError) {
      const errMsg = res.content.map((c) => c.text ?? "").join("\n");
      throw new Error(`MCP tool '${tool}' error: ${errMsg}`);
    }

    const textContent = res.content.find((c) => c.type === "text");
    if (textContent?.text) {
      try {
        return JSON.parse(textContent.text);
      } catch {
        return textContent.text;
      }
    }

    return res.content;
  }
}
