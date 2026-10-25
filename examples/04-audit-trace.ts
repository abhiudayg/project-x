import { auditTrace } from "../src/index.js";

const run = () => {
  const sampleOpenAITrace = {
    name: "incident-investigation",
    messages: [
      { role: "user", content: "Check why prod cluster is degraded" },
      {
        role: "assistant",
        tool_calls: [
          {
            id: "call_dep",
            type: "function",
            function: {
              name: "list_deployments",
              arguments: JSON.stringify({ namespace: "production" }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_dep",
        content: JSON.stringify({
          failingDeploymentId: "dep-billing-99",
          status: "crash_loop_backoff",
        }),
      },
      {
        role: "assistant",
        tool_calls: [
          {
            id: "call_logs",
            type: "function",
            function: {
              name: "fetch_logs",
              arguments: JSON.stringify({ deploymentId: "dep-billing-99", tailLines: 50 }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_logs",
        content: JSON.stringify({
          errors: ["OOMKilled: container exceeded 2GiB limit"],
        }),
      },
      {
        role: "assistant",
        tool_calls: [
          {
            id: "call_restart",
            type: "function",
            function: {
              name: "restart_deployment",
              arguments: JSON.stringify({ deploymentId: "dep-billing-99" }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_restart",
        content: JSON.stringify({ restarted: true }),
      },
    ],
  };

  const report = auditTrace(sampleOpenAITrace);
  console.log(report.markdownSummary);
  console.log("\nGenerated Plan YAML:\n");
  console.log(report.planYaml);
};

run();
