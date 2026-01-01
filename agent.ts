import "dotenv/config";
import OpenAI from "openai";

// Type definitions for Flux
type TapbackType = "love" | "like" | "dislike" | "laugh" | "emphasize" | "question";
type SendMessageFn = (to: string, text: string) => Promise<boolean>;
type SendTapbackFn = (messageGuid: string, reaction: TapbackType, userPhoneNumber: string) => Promise<boolean>;

// Store functions from onInit
let sendTapback: SendTapbackFn | undefined;

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Conversation history per user
const conversations: Map<string, Array<{ role: "user" | "assistant" | "system"; content: string }>> = new Map();

// System prompt for the chatbot
const SYSTEM_PROMPT = `You are a friendly and helpful conversational assistant communicating via iMessage.
Keep responses concise and natural - this is a text conversation, not an essay.
Be warm, engaging, and use occasional emojis where appropriate.

IMPORTANT: When the user expresses POSITIVE emotion, you MUST start your response with exactly this format (no variations):
[TAPBACK:love] - for gratitude, excitement, good news
[TAPBACK:laugh] - for jokes, "lol", "haha", funny things
[TAPBACK:emphasize] - for "awesome!", "wow!", impressive things
[TAPBACK:like] - for agreement, "cool", "nice"

NEVER use tapbacks for:
- Serious, sad, or concerning messages
- Questions or confusion (do NOT use [TAPBACK:question])
- Negative emotions or distress

The format MUST be exactly [TAPBACK:type] - not [Laugh], not [Love], not any other format.

Examples of CORRECT responses:
- User: "thanks!" -> "[TAPBACK:love] You're welcome!"
- User: "lol" -> "[TAPBACK:laugh] Glad you found that funny!"
- User: "I got promoted!" -> "[TAPBACK:love] That's amazing, congratulations!"

Only use tapbacks when genuinely appropriate for positive moments.`;

// Parse tapback from response
function extractTapback(response: string): { tapback: TapbackType | null; cleanResponse: string } {
  // Try the correct format first: [TAPBACK:type]
  let tapbackMatch = response.match(/^\[TAPBACK:(love|like|dislike|laugh|emphasize|question)\]/i);

  // Fallback: handle incorrect formats like [Laugh], [Love], etc.
  if (!tapbackMatch) {
    tapbackMatch = response.match(/^\[(Love|Like|Dislike|Laugh|Emphasize|Question)\]/i);
  }

  if (tapbackMatch) {
    const tapback = tapbackMatch[1].toLowerCase() as TapbackType;
    const cleanResponse = response.replace(tapbackMatch[0], "").trim();
    return { tapback, cleanResponse };
  }
  return { tapback: null, cleanResponse: response };
}

// Get or create conversation history
function getConversation(userPhone: string) {
  if (!conversations.has(userPhone)) {
    conversations.set(userPhone, [{ role: "system", content: SYSTEM_PROMPT }]);
  }
  return conversations.get(userPhone)!;
}

// Limit conversation history to prevent token overflow
function trimConversation(history: Array<{ role: "user" | "assistant" | "system"; content: string }>) {
  const MAX_MESSAGES = 20;
  if (history.length > MAX_MESSAGES) {
    // Keep system prompt and last N messages
    const systemPrompt = history[0];
    const recentMessages = history.slice(-MAX_MESSAGES + 1);
    history.length = 0;
    history.push(systemPrompt, ...recentMessages);
  }
}

interface InvokeParams {
  message: string;
  userPhoneNumber: string;
  messageGuid?: string;
}

export default {
  onInit: async (_sendMessage: SendMessageFn, _sendTapback: SendTapbackFn) => {
    sendTapback = _sendTapback;
    console.log("[AGENT] onInit called - ChatGPT agent ready with tapback support!");
  },

  invoke: async ({ message, userPhoneNumber, messageGuid }: InvokeParams) => {
    console.log("[AGENT] Message from", userPhoneNumber, ":", message);
    console.log("[AGENT] messageGuid:", messageGuid);

    // Handle special commands
    const lowerMessage = message.toLowerCase().trim();

    if (lowerMessage === "clear" || lowerMessage === "reset") {
      conversations.delete(userPhoneNumber);
      return "Conversation cleared! Let's start fresh. 🔄";
    }

    try {
      // Get conversation history
      const history = getConversation(userPhoneNumber);

      // Add user message
      history.push({ role: "user", content: message });

      // Trim if too long
      trimConversation(history);

      // Call OpenAI
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: history,
        max_tokens: 300,
        temperature: 0.8,
      });

      const response = completion.choices[0]?.message?.content || "I'm not sure how to respond to that.";

      // Extract tapback if suggested by GPT
      const { tapback, cleanResponse } = extractTapback(response);

      // Send tapback if appropriate
      if (tapback && sendTapback && messageGuid) {
        try {
          console.log("[AGENT] Sending tapback:", tapback);
          await sendTapback(messageGuid, tapback, userPhoneNumber);
        } catch (err) {
          console.log("[AGENT] Tapback error:", (err as Error).message);
        }
      }

      // Add assistant response to history (without tapback tag)
      history.push({ role: "assistant", content: cleanResponse });

      return cleanResponse;
    } catch (err) {
      console.error("[AGENT] OpenAI error:", err);
      return "Sorry, I'm having trouble connecting right now. Try again in a moment! 🔄";
    }
  },

  onError: async (error: Error) => {
    console.error("[AGENT] Error:", error);
  },

  onShutdown: async () => {
    console.log("[AGENT] Shutting down...");
  },
};
