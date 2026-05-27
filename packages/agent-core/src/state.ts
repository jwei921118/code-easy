import { Annotation } from "@langchain/langgraph";

export type PlanStep = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed";
};

export const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<string[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => []
  }),
  plan: Annotation<PlanStep[]>({
    reducer: (_left, right) => right,
    default: () => []
  }),
  workspaceRoot: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => process.cwd()
  })
});

export type AgentState = typeof AgentStateAnnotation.State;
