import * as dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";
import { Composio } from "composio-core";

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
});

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY! });
const entity = composio.getEntity("default");

// Flux provides these via onInit (production mode only)
let sendMessage: ((to: string, text: string) => Promise<boolean>) | undefined;

// Track seen email IDs to avoid duplicate notifications
const seenEmailIds = new Set<string>();

// Your phone number - will be set when you first message the agent
let myPhoneNumber: string | undefined;

const SYSTEM_PROMPT = `You are a helpful email assistant. You notify the user about new emails and can answer questions about their inbox. Keep responses concise.`;

// Check for new emails
async function checkForNewEmails(): Promise<{ id: string; from: string; subject: string; snippet: string }[]> {
  try {
    const result = await entity.execute({
      actionName: "GMAIL_FETCH_EMAILS",
      params: {
        max_results: 10,
        label_ids: ["INBOX"],
      },
    });

    const data = result.data as any;
    if (!result.successfull || !data?.messages) return [];

    const newEmails: { id: string; from: string; subject: string; snippet: string }[] = [];

    for (const email of data.messages) {
      const emailId = email.id || email.messageId;
      if (emailId && !seenEmailIds.has(emailId)) {
        seenEmailIds.add(emailId);
        newEmails.push({
          id: emailId,
          from: email.from || "Unknown sender",
          subject: email.subject || "No subject",
          snippet: email.snippet || email.body?.substring(0, 100) || "",
        });
      }
    }

    return newEmails;
  } catch (error) {
    console.error("[Email] Fetch error:", error);
    return [];
  }
}

// Initialize seen emails on startup (so we don't notify for old emails)
async function initializeSeenEmails() {
  try {
    const result = await entity.execute({
      actionName: "GMAIL_FETCH_EMAILS",
      params: {
        max_results: 20,
        label_ids: ["INBOX"],
      },
    });

    const data = result.data as any;
    if (result.successfull && data?.messages) {
      for (const email of data.messages) {
        const emailId = email.id || email.messageId;
        if (emailId) seenEmailIds.add(emailId);
      }
      console.log(`[Email] Initialized with ${seenEmailIds.size} existing emails`);
    }
  } catch (error) {
    console.error("[Email] Init error:", error);
  }
}

export default {
  async onInit(_sendMessage?: typeof sendMessage) {
    sendMessage = _sendMessage;
    console.log("[Agent] Initialized", { hasProactive: !!sendMessage });

    // Initialize seen emails so we don't notify for existing ones
    await initializeSeenEmails();

    // Start polling for new emails every 30 seconds
    if (sendMessage) {
      setInterval(async () => {
        if (!myPhoneNumber) {
          console.log("[Email] Waiting for user to message first...");
          return;
        }

        console.log("[Email] Checking for new emails...");
        const newEmails = await checkForNewEmails();

        for (const email of newEmails) {
          const notification = `📧 New email from ${email.from}:\n"${email.subject}"\n\n${email.snippet}...`;
          console.log(`[Email] Notifying: ${email.subject}`);
          await sendMessage!(myPhoneNumber, notification);
        }
      }, 10000); // Check every 10 seconds
    }
  },

  async invoke({ message, userPhoneNumber }: {
    message: string;
    userPhoneNumber: string;
  }): Promise<string> {
    // Remember the user's phone number for proactive notifications
    myPhoneNumber = userPhoneNumber;

    const lowerMessage = message.toLowerCase();

    // Manual email check
    if (lowerMessage.includes("email") || lowerMessage.includes("inbox") || lowerMessage.includes("mail")) {
      console.log("[Agent] Manual email check requested");

      try {
        const result = await entity.execute({
          actionName: "GMAIL_FETCH_EMAILS",
          params: {
            max_results: 5,
            label_ids: ["INBOX"],
          },
        });

        const data = result.data as any;
        if (!result.successfull || !data?.messages || data.messages.length === 0) {
          return "No emails found in your inbox.";
        }

        const emails = data.messages.slice(0, 5).map((email: any, i: number) => {
          const emailId = email.id || email.messageId;
          if (emailId) seenEmailIds.add(emailId); // Mark as seen
          return `${i + 1}. From: ${email.from || "Unknown"}\n   Subject: ${email.subject || "No subject"}`;
        }).join("\n\n");

        return `Your latest emails:\n\n${emails}`;
      } catch (error) {
        console.error("[Email] Error:", error);
        return "Couldn't fetch emails right now. Try again later.";
      }
    }

    // Regular conversation
    try {
      const response = await openrouter.chat.completions.create({
        model: "openai/gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: message }
        ],
        max_tokens: 256,
      });

      return response.choices[0]?.message?.content || "hmm let me think";
    } catch (error) {
      console.error("Error:", error);
      return "something went wrong, try again?";
    }
  }
};
