import "dotenv/config";

// Type definitions for Flux
type TapbackType = "love" | "like" | "dislike" | "laugh" | "emphasize" | "question";
type SendMessageFn = (to: string, text: string) => Promise<boolean>;
type SendTapbackFn = (messageGuid: string, tapback: TapbackType) => Promise<boolean>;

interface InvokeParams {
  message: string;
  userPhoneNumber: string;
  messageGuid?: string;
  imageBase64?: string;
}

interface FluxAgent {
  sendMessage?: SendMessageFn;
  sendTapback?: SendTapbackFn;
  onInit?: (sendMessage: SendMessageFn, sendTapback: SendTapbackFn) => Promise<void>;
  invoke: (params: InvokeParams) => Promise<string>;
  onError?: (error: Error) => Promise<void>;
  onShutdown?: () => Promise<void>;
}

const agent: FluxAgent = {
  sendMessage: undefined,
  sendTapback: undefined,

  onInit: async (sendMessage, sendTapback) => {
    agent.sendMessage = sendMessage;
    agent.sendTapback = sendTapback;
    console.log("[AGENT] onInit called with tapback support!");
  },

  invoke: async ({ message, messageGuid }) => {
    const lowerMessage = message.toLowerCase().trim();

    // Debug logging
    console.log("[AGENT] invoke called");
    console.log("[AGENT] messageGuid:", messageGuid);
    console.log("[AGENT] sendTapback available:", !!agent.sendTapback);

    // React with love to thank you messages
    if (lowerMessage.includes("thank you") || lowerMessage.includes("thanks")) {
      if (agent.sendTapback && messageGuid) {
        try {
          console.log("[AGENT] Sending love tapback...");
          await agent.sendTapback(messageGuid, "love");
          console.log("[AGENT] Tapback sent successfully!");
        } catch (err) {
          console.log("[AGENT] Tapback error:", (err as Error).message);
        }
      }
      return "You're welcome! 😊";
    }

    // React with laugh to jokes/funny
    if (lowerMessage.includes("lol") || lowerMessage.includes("haha") || lowerMessage.includes("funny")) {
      if (agent.sendTapback && messageGuid) {
        try {
          await agent.sendTapback(messageGuid, "laugh");
        } catch (err) {
          console.log("[AGENT] Tapback error:", (err as Error).message);
        }
      }
      return "Glad you found it funny! 😄";
    }

    // React with emphasis to excitement
    if (lowerMessage.includes("!") && (lowerMessage.includes("wow") || lowerMessage.includes("amazing") || lowerMessage.includes("awesome"))) {
      if (agent.sendTapback && messageGuid) {
        try {
          await agent.sendTapback(messageGuid, "emphasize");
        } catch (err) {
          console.log("[AGENT] Tapback error:", (err as Error).message);
        }
      }
      return "I know right?!\nThat's exciting!";
    }

    // React with like to positive messages
    if (lowerMessage.includes("cool") || lowerMessage.includes("nice") || lowerMessage.includes("great")) {
      if (agent.sendTapback && messageGuid) {
        try {
          await agent.sendTapback(messageGuid, "like");
        } catch (err) {
          console.log("[AGENT] Tapback error:", (err as Error).message);
        }
      }
      return "👍";
    }

    // React with question to confusing messages
    if (lowerMessage.includes("?") && lowerMessage.length < 10) {
      if (agent.sendTapback && messageGuid) {
        try {
          await agent.sendTapback(messageGuid, "question");
        } catch (err) {
          console.log("[AGENT] Tapback error:", (err as Error).message);
        }
      }
      return "Could you tell me more?";
    }

    // Greeting - multiple bubbles
    if (lowerMessage === "hi" || lowerMessage === "hello" || lowerMessage === "hey") {
      return "Hey there! 👋\nHow's it going?\nWhat can I help you with today?";
    }

    // Test command
    if (lowerMessage === "test") {
      return "Bubble 1: First message\nBubble 2: Second message\nBubble 3: Third message";
    }

    // Help command
    if (lowerMessage === "help") {
      return "📱 Chat Agent with Tapbacks!\n\nTry saying:\n• 'thanks' - I'll ❤️ your message\n• 'haha' - I'll 😂 your message\n• 'awesome!' - I'll ‼️ your message\n• 'cool' - I'll 👍 your message";
    }

    // Default
    return "I'm here! Try 'hi', 'test', 'help', or say 'thanks' to see tapbacks! 😊";
  },

  onError: async (error) => {
    console.error("[AGENT] Error:", error);
  },

  onShutdown: async () => {
    console.log("[AGENT] Shutting down...");
  },
};

export default agent;
