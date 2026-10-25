import { InMemoryToolAdapter, MCPGatewayProxy } from "../src/index.js";

const run = async () => {
  const upstream = new InMemoryToolAdapter();

  upstream.registerTool({
    capability: {
      name: "kubernetes.get_pods",
      type: "read",
      description: "List pods in namespace",
    },
    handler: async () => ({ pods: ["pod-1", "pod-2"], phase: "Running" }),
  });

  upstream.registerTool({
    capability: {
      name: "kubernetes.restart_pod",
      type: "write",
      description: "Restart a pod",
    },
    handler: async (args) => ({ restarted: true, pod: args.podName }),
  });

  const proxy = new MCPGatewayProxy(upstream, {
    policy: {
      allowWrites: false,
    },
  });

  const tools = await proxy.listTools();
  console.log(`Advertised Tools (${tools.length}):`, tools.map((t) => t.name));

  const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: inspect-workload
spec:
  steps:
    - id: pods
      tool: kubernetes.get_pods
      arguments:
        namespace: "production"
  output:
    include:
      - pods
`;

  const result = await proxy.callTool("x_execute_plan", { planYaml });
  const parsedContent = JSON.parse(result.content[0]?.text ?? "{}");
  console.log(`Plan Status: ${parsedContent.status}`);
  console.log(`Outputs:`, parsedContent.outputs);

  try {
    const mutatingPlanYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: restart-workload
spec:
  steps:
    - id: restart
      tool: kubernetes.restart_pod
      arguments:
        podName: "pod-1"
  output:
    include:
      - restart
`;
    await proxy.callTool("x_execute_plan", { planYaml: mutatingPlanYaml });
  } catch (err) {
    console.log(`Expected Pre-Flight Gating Error:`, err instanceof Error ? err.message : String(err));
  }
};

run().catch(console.error);
