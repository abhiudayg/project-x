import { ToolAdapter, ToolCapability } from "./adapters/types.js";
import { VerificationStatus } from "./types.js";

export class Verifier {
  static async evaluateStep(
    tool: ToolCapability,
    stepResult: unknown,
    resolvedArgs: Record<string, unknown>,
    adapter: ToolAdapter
  ): Promise<VerificationStatus> {
    if (!tool.verificationTool) {
      return "unverified";
    }

    try {
      if (adapter.verify) {
        const customVerified = await adapter.verify(
          tool.name,
          stepResult,
          resolvedArgs
        );
        if (customVerified) {
          return "verified";
        }
      }

      const readBackResult = await adapter.execute(
        tool.verificationTool,
        resolvedArgs
      );

      const expected = JSON.stringify(stepResult);
      const actual = JSON.stringify(readBackResult);
      return expected === actual ? "verified" : "failed";
    } catch {
      return "failed";
    }
  }
}
