import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { HumanMessage } from "@langchain/core/messages";

// Define a simple calculator tool
const calculatorTool = tool(
  async ({ a, b, operation }) => {
    switch (operation) {
      case "add":
        return `${a} + ${b} = ${a + b}`;
      case "subtract":
        return `${a} - ${b} = ${a - b}`;
      case "multiply":
        return `${a} * ${b} = ${a * b}`;
      case "divide":
        if (b === 0) return "Error: Cannot divide by zero";
        return `${a} / ${b} = ${a / b}`;
      default:
        return "Unknown operation";
    }
  },
  {
    name: "calculator",
    description: "A simple calculator that can add, subtract, multiply, or divide two numbers",
    schema: z.object({
      a: z.number().describe("The first number"),
      b: z.number().describe("The second number"),
      operation: z.enum(["add", "subtract", "multiply", "divide"]).describe("The operation to perform"),
    }),
  }
);

// Create the model
const model = new ChatOpenAI({
  model: "gpt-4o",
  apiKey: process.env.OPENAI_APIKEY,
});

// Create the LangGraph agent
const langGraphAgent = createReactAgent({
  llm: model,
  tools: [calculatorTool],
});

// Wrapper for Flux compatibility
const agent = {
  async invoke(input) {
    const result = await langGraphAgent.invoke({
      messages: [new HumanMessage(input.message)],
    });
    const lastMessage = result.messages[result.messages.length - 1];
    return typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);
  },
};

export default agent;
