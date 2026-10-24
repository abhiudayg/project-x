import { ToolAdapter, ToolCapability } from "../adapters/types.js";
import { Interpreter } from "../interpreter.js";
import { RuntimePolicy } from "../policy.js";
import { ExecutionReceipt } from "../types.js";

export interface MCPGatewayOptions {
  readonly policy?: RuntimePolicy;
  readonly defaultTimeoutMs?: number;
}

export interface MCPToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface MCPCallToolResponse {
  readonly content: Array<{ readonly type: string; readonly text?: string }>;
  readonly isError?: boolean;
}

export class MCPGatewayProxy {
  private readonly interpreter: Interpreter;

  constructor(
    private readonly upstreamAdapter: ToolAdapter,
    private readonly options: MCPGatewayOptions = {}
  ) {
    this.interpreter = new Interpreter(upstreamAdapter, {
      policy: options.policy,
    });
  }

  async listTools(): Promise<readonly MCPToolDefinition[]> {
    const upstream = await this.upstreamAdapter.listTools();
    const mapped: MCPToolDefinition[] = upstream.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: {
        type: "object",
        properties: {},
      },
    }));

    const xExecutePlanTool: MCPToolDefinition = {
      name: "x_execute_plan",
      description:
        "Execute a bounded, declarative multi-tool execution plan (x.dev/v1alpha1) with deterministic orchestration, DAG cycle detection, and security gating.",
      inputSchema: {
        type: "object",
        properties: {
          plan: {
            type: "string",
            description: "The ExecutionPlan YAML or JSON string.",
          },
        },
        required: ["plan"],
      },
    };

    return [...mapped, xExecutePlanTool];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<MCPCallToolResponse> {
    if (name === "x_execute_plan") {
      const planRaw = args.plan ?? args.planYaml;
      if (typeof planRaw !== "string") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Invalid arguments: 'plan' must be a YAML or JSON string.",
            },
          ],
        };
      }

      try {
        const result = await this.interpreter.execute(planRaw);
        return {
          isError: result.receipt.status === "failed",
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  receipt: result.receipt,
                  outputs: result.outputs,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Plan execution rejected: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    }

    try {
      const rawResult = await this.upstreamAdapter.execute(name, args);
      return {
        isError: false,
        content: [
          {
            type: "text",
            text:
              typeof rawResult === "string"
                ? rawResult
                : JSON.stringify(rawResult, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Tool '${name}' execution failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  }

  async handleJsonRpc(request: {
    readonly id: string | number;
    readonly method: string;
    readonly params?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    if (request.method === "tools/list") {
      const tools = await this.listTools();
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: { tools },
      };
    }

    if (request.method === "tools/call") {
      const name = String(request.params?.name ?? "");
      const args = (request.params?.arguments as Record<string, unknown>) ?? {};
      const result = await this.callTool(name, args);
      return {
        jsonrpc: "2.0",
        id: request.id,
        result,
      };
    }

    return {
      jsonrpc: "2.0",
      id: request.id,
      error: {
        code: -32601,
        message: `Method '${request.method}' not supported by MCP Gateway Proxy`,
      },
    };
  }
}
