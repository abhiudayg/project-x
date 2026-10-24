import { ToolAdapter, ToolCapability } from "./types.js";

export interface MockToolRegistration {
  readonly capability: ToolCapability;
  readonly handler: (
    args: Record<string, unknown>,
    signal?: AbortSignal
  ) => Promise<unknown> | unknown;
  readonly verifyHandler?: (
    stepResult: unknown,
    args: Record<string, unknown>
  ) => Promise<boolean> | boolean;
}

export class InMemoryToolAdapter implements ToolAdapter {
  private readonly registry = new Map<string, MockToolRegistration>();

  registerTool(registration: MockToolRegistration): void {
    this.registry.set(registration.capability.name, registration);
  }

  async listTools(): Promise<readonly ToolCapability[]> {
    return Array.from(this.registry.values()).map((r) => r.capability);
  }

  async getTool(name: string): Promise<ToolCapability | undefined> {
    return this.registry.get(name)?.capability;
  }

  async execute(
    tool: string,
    args: Record<string, unknown>,
    options?: {
      signal?: AbortSignal;
      idempotencyKey?: string;
      callerIdentity?: string;
    }
  ): Promise<unknown> {
    const reg = this.registry.get(tool);
    if (!reg) {
      throw new Error(`Tool not found: '${tool}'`);
    }

    if (reg.capability.schema) {
      reg.capability.schema.parse(args);
    }

    if (options?.signal?.aborted) {
      throw new Error(`Tool execution aborted for '${tool}'`);
    }

    return await reg.handler(args, options?.signal);
  }

  async verify(
    tool: string,
    stepResult: unknown,
    args: Record<string, unknown>
  ): Promise<boolean> {
    const reg = this.registry.get(tool);
    if (!reg || !reg.verifyHandler) {
      return false;
    }
    return await reg.verifyHandler(stepResult, args);
  }
}
