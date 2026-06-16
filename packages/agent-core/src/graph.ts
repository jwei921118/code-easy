import { END, START, StateGraph } from "@langchain/langgraph";
import { AgentStateAnnotation } from "./state.js";

/** 创建当前最小 LangGraph 流程，为后续 plan/act/observe/verify 节点预留入口。 */
export function createCodeEasyGraph() {
  return new StateGraph(AgentStateAnnotation)
    .addNode("intake", async (state) => {
      const lastMessage = state.messages.at(-1) ?? "";

      return {
        plan: [
          {
            id: "understand-request",
            title: lastMessage.length > 0 ? `Understand: ${lastMessage}` : "Understand the request",
            status: "completed" as const
          }
        ],
        messages: ["Runtime initialized."]
      };
    })
    .addEdge(START, "intake")
    .addEdge("intake", END)
    .compile();
}
