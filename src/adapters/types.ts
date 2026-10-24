import { ZodType } from "zod";

export interface ToolCapability {
  readonly name: string;
  readonly description?: string;
  readonly type: "read" | "write";
  readonly schema?: ZodType;
  readonly idempotent?: boolean;
  readonly verificationTool?: string;
  readonly defaultTimeoutMs?: number;
}

export interface ToolAdapter {
  listTools(): Promise<readonly ToolCapability[]>;
  getTool(name: string): Promise<ToolCapability | undefined>;
  execute(
    tool: string,
    args: Record<string, unknown>,
    options?: {
      signal?: AbortSignal;
      idempotencyKey?: string;
      callerIdentity?: string;
    }
  ): Promise<unknown>;
  verify?(
    tool: string,
    stepResult: unknown,
    args: Record<string, unknown>
  ): Promise<boolean>;
}
