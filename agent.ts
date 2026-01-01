import "dotenv/config";
import OpenAI from "openai";

const openai = new OpenAI();
const conversations = new Map<string, Array<{ role: "user" | "assistant" | "system"; content: string }>>();

let sendTapback: ((messageGuid: string, reaction: string, userPhoneNumber: string) => Promise<boolean>) | undefined;

export default {
  onInit: async (_sendMessage: any, _sendTapback: any) => {
    sendTapback = _sendTapback;
  },

  invoke: async ({ message, userPhoneNumber, messageGuid }: { message: string; userPhoneNumber: string; messageGuid?: string }) => {
    // Get or create conversation history
    if (!conversations.has(userPhoneNumber)) {
      conversations.set(userPhoneNumber, [{
        role: "system",
        content: "You are a friendly iMessage assistant. Keep responses concise. For positive messages, start with [TAPBACK:love], [TAPBACK:laugh], or [TAPBACK:like]."
      }]);
    }
    const history = conversations.get(userPhoneNumber)!;
    history.push({ role: "user", content: message });

    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: history,
    });

    let response = completion.choices[0]?.message?.content || "Hello!";

    // Extract and send tapback if present
    const tapbackMatch = response.match(/^\[TAPBACK:(love|like|laugh|emphasize)\]/i);
    if (tapbackMatch && sendTapback && messageGuid) {
      await sendTapback(messageGuid, tapbackMatch[1].toLowerCase(), userPhoneNumber);
      response = response.replace(tapbackMatch[0], "").trim();
    }

    history.push({ role: "assistant", content: response });
    return response;
  },
};
