import * as dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";
import { Composio } from "composio-core";

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
});

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY! });

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };
const conversations = new Map<string, ChatMessage[]>();

function getHistory(userId: string): ChatMessage[] {
  if (!conversations.has(userId)) conversations.set(userId, []);
  return conversations.get(userId)!;
}

function addMessage(userId: string, role: "user" | "assistant", content: string): void {
  const history = getHistory(userId);
  history.push({ role, content });
  if (history.length > 20) history.splice(0, history.length - 20);
}

async function searchWeb(query: string): Promise<string> {
  try {
    const entity = composio.getEntity("default");
    const result = await entity.execute({
      actionName: "COMPOSIO_SEARCH_SEARCH",
      params: { query, num_results: 5 },
    });

    const data = result.data as any;
    if (!result.successfull) return "";

    // The results are nested: data.results.organic_results
    const searchResults = data?.results?.organic_results || data?.organic_results || [];
    if (!Array.isArray(searchResults) || searchResults.length === 0) return "";

    return searchResults.slice(0, 5).map((r: any, i: number) =>
      `${i + 1}. ${r.title || 'Result'}\n   ${r.snippet || r.description || ""}`
    ).join("\n\n");
  } catch (error) {
    console.error("Search error:", error);
    return "";
  }
}

function needsWebSearch(message: string): boolean {
  const patterns = [/what is/i, /who is/i, /when/i, /where/i, /how/i, /why/i, /latest/i, /news/i, /\?$/];
  return patterns.some(p => p.test(message));
}

const SYSTEM_PROMPT = `You are a helpful assistant that can search the web. Answer questions naturally using search results when needed. Keep responses concise.`;

export default {
  async invoke({ message, userPhoneNumber }: { message: string; userPhoneNumber: string }): Promise<string> {
    const history = getHistory(userPhoneNumber);

    let searchContext = "";
    if (needsWebSearch(message)) {
      console.log("[Agent] Searching web for:", message);
      const results = await searchWeb(message);
      if (results) searchContext = `\n\n[Search results]:\n${results}`;
    }

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: message + searchContext }
    ];

    const completion = await openrouter.chat.completions.create({
      model: "openai/gpt-4o-mini",
      messages,
      max_tokens: 256,
    });

    const response = completion.choices[0]?.message?.content || "hmm let me think";
    addMessage(userPhoneNumber, "user", message);
    addMessage(userPhoneNumber, "assistant", response);
    return response;
  }
};
