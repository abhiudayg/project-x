import vm from "node:vm";
import { ToolAdapter } from "../adapters/types.js";
import { PolicyEngine } from "../policy.js";

export interface SandboxExecutionOptions {
  readonly timeoutMs?: number;
  readonly callerIdentity?: string;
}

export interface SandboxExecutionResult {
  readonly success: boolean;
  readonly output: unknown;
  readonly executedCalls: readonly { tool: string; args: Record<string, unknown> }[];
  readonly error?: Error;
}

export class HardenedCodeModeSandbox {
  constructor(
    private readonly adapter: ToolAdapter,
    private readonly policy: PolicyEngine
  ) {}

  async run(
    scriptCode: string,
    options: SandboxExecutionOptions = {}
  ): Promise<SandboxExecutionResult> {
    const executedCalls: { tool: string; args: Record<string, unknown> }[] = [];
    const timeoutMs = options.timeoutMs ?? 5000;

    let outputResult: unknown = null;

    const sandboxContext = {
      invokeTool: async (toolName: string, toolArgs: Record<string, unknown>) => {
        const toolCap = await this.adapter.getTool(toolName);
        if (!toolCap) {
          throw new Error(`Sandbox: Tool not found '${toolName}'`);
        }

        this.policy.checkToolBoundary("sandbox-step", toolCap);
        executedCalls.push({ tool: toolName, args: toolArgs });

        return await this.adapter.execute(toolName, toolArgs, {
          callerIdentity: options.callerIdentity,
        });
      },
      setOutput: (val: unknown) => {
        outputResult = val;
      },
      console: Object.freeze({
        log: () => {},
        error: () => {},
      }),
    };

    const context = vm.createContext(sandboxContext);

    try {
      const wrappedScript = `(async () => {\n${scriptCode}\n})()`;
      const script = new vm.Script(wrappedScript);
      const promise = script.runInContext(context, {
        timeout: timeoutMs,
      }) as Promise<unknown>;

      await promise;

      return {
        success: true,
        output: outputResult,
        executedCalls,
      };
    } catch (err) {
      return {
        success: false,
        output: null,
        executedCalls,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }
}
