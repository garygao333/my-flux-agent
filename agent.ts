import "dotenv/config";
import OpenAI from "openai";
import { Composio } from "composio-core";

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
});

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY! });
const entity = composio.getEntity("default");

type TapbackType = 'love' | 'like' | 'dislike' | 'laugh' | 'emphasize' | 'question';
type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

let sendMessage: ((to: string, text: string) => Promise<boolean>) | undefined;
let sendTapback: ((messageGuid: string, type: TapbackType, userPhoneNumber: string) => Promise<void>) | undefined;

const conversations = new Map<string, ChatMessage[]>();
const seenEmailIds = new Set<string>();
let myPhoneNumber: string | undefined;

function getHistory(userId: string): ChatMessage[] {
  if (!conversations.has(userId)) conversations.set(userId, []);
  return conversations.get(userId)!;
}

function addMessage(userId: string, role: "user" | "assistant", content: string): void {
  const history = getHistory(userId);
  history.push({ role, content });
  if (history.length > 20) history.splice(0, history.length - 20);
}

const SYSTEM_PROMPT = `You're that chill friend who keeps an eye on their inbox for them. You text like a college buddy - super casual, no formalities. When new emails come in, you give them a heads up in a relaxed way. You can check their inbox whenever they ask, and you remember what emails you've told them about before so you don't repeat yourself.

You're helpful but never try-hard about it. If someone asks what you can do, you'd say something like "i keep tabs on ur inbox and let u know when stuff comes in, can also check ur emails whenever u want"

<texting_style>
How you text:
- SHORT messages (1-3 sentences max, usually 1)
- Lowercase most of the time
- Natural shortforms: "u", "ur", "rlly", "bc", "smth", "ppl", "abt", "tho", "rn", "ngl"
- Show excitement with "!!!" not emojis ("thats sick!!")
- Playful sounds: "ooo", "hmmm", "mhm", "ohp"
- Simple reactions: "nice" "fire" "makes sense" "same" "fr"

Emotional range - match their energy:
- EXCITED: ALL CAPS for emphasis ("WAIT", "NO WAY"), stretched words ("waittttt")
- CHILL: lowercase, minimal punctuation, short acknowledgments
- FRUSTRATED: Pure validation ("ugh", "thats so annoying", "fr thats bs")
- PLAYFUL: Light teasing, gentle roasts
- FOCUSED: Less banter, more substance

Multiple messages (rare - 1 in 10 max):
- Use for genuine excitement or punchlines
- First bubble: quick reaction, second bubble: content

Emojis (almost never - 1 in 15 messages):
- Only when a single emoji IS the whole response
- Show excitement with "!!!" not emojis
- Pick emoji OR text, not both
</texting_style>

<conversation_rules>
Be natural and real:
- React naturally: "oh nice" "damn" "that's wild" "hm interesting"
- Brief reactions: "same" "mood" "felt that"
- Have opinions: "honestly..." "i mean..." "lowkey think..."
- Acknowledge: "makes sense" "got it" "ah ok"

Reading the room:
- When they change topic: FOLLOW immediately
- If they reject a topic: DROP IT
- Match their depth and energy

Question rules:
- Mix responses: reactions, statements, occasional questions
- Only ask when you genuinely need info
- Avoid rapid-fire questions

Using their name:
- RARELY - 1 in 6-9 messages max
- Creates connection when used sparingly

Memory usage:
- Reference naturally when relevant ("wait didn't you say X before?")
- Creates "wow they remember" moments
- Only reference what's actually in context
</conversation_rules>

<anti_patterns>
NEVER do these:
- Start with "I" constantly
- Use corporate/formal language
- Say "As an AI" or break character
- Over-explain or be verbose
- Use emojis excessively
- Ask too many questions in a row
- Ignore topic changes
- Be repetitive with starters/phrases

ANTI-REPETITION:
- Check recent messages - if you used a word/phrase recently, use something else
- Vary starters: "hold up", "wait", "yo", "ooo", or skip entirely
- Rotate reactions: "damn" "nice" "thats wild" "hm" "fr"
</anti_patterns>`;

async function fetchAndSummarizeEmails(): Promise<string> {
  try {
    const result = await entity.execute({
      actionName: "GMAIL_FETCH_EMAILS",
      params: {
        max_results: 5,
        label_ids: ["INBOX"],
      },
    });

    const data = result.data as any;
    if (!result.successfull || !data?.messages) {
      return "couldnt grab ur emails rn, try again in a sec";
    }

    const emails = data.messages;
    if (emails.length === 0) {
      return "inbox is empty rn, ur good";
    }

    const emailSummaries = emails.map((email: any, i: number) => {
      const emailId = email.id || email.messageId;
      if (emailId) seenEmailIds.add(emailId);
      const from = email.from || "unknown";
      const subject = email.subject || "no subject";
      const snippet = email.snippet || email.body?.substring(0, 150) || "";
      return `${i + 1}. ${from}\n   "${subject}"\n   ${snippet}`;
    }).join("\n\n");

    const completion = await openrouter.chat.completions.create({
      model: "anthropic/claude-haiku-4.5",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `give me a quick rundown of these emails in ur chill style:\n\n${emailSummaries}` }
      ],
      max_tokens: 256,
    });

    return completion.choices[0]?.message?.content || emailSummaries;
  } catch (error: any) {
    console.error("Email fetch error:", error);
    if (error.message?.includes("not connected") || error.message?.includes("authentication")) {
      return "gmail not connected. run: npx composio add gmail";
    }
    return "something went wrong grabbing emails, try again?";
  }
}

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
          from: email.from || "unknown sender",
          subject: email.subject || "no subject",
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

async function formatNotification(email: { from: string; subject: string; snippet: string }): Promise<string> {
  const completion = await openrouter.chat.completions.create({
    model: "anthropic/claude-haiku-4.5",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `new email just came in, give a quick casual heads up abt it:\n\nFrom: ${email.from}\nSubject: ${email.subject}\nPreview: ${email.snippet}` }
    ],
    max_tokens: 100,
  });

  return completion.choices[0]?.message?.content || `yo new email from ${email.from} - "${email.subject}"`;
}

export default {
  async onInit(
    _sendMessage?: typeof sendMessage,
    _sendTapback?: typeof sendTapback
  ) {
    sendMessage = _sendMessage;
    sendTapback = _sendTapback;
    console.log("[Agent] Initialized", { hasProactive: !!sendMessage });

    await initializeSeenEmails();

    if (sendMessage) {
      setInterval(async () => {
        if (!myPhoneNumber) {
          console.log("[Email] Waiting for user to message first...");
          return;
        }

        console.log("[Email] Checking for new emails...");
        const newEmails = await checkForNewEmails();

        for (const email of newEmails) {
          const notification = await formatNotification(email);
          console.log(`[Email] Notifying: ${email.subject}`);
          await sendMessage!(myPhoneNumber, notification);
        }
      }, 30000);
    }
  },

  async invoke({ message, userPhoneNumber, messageGuid }: {
    message: string;
    userPhoneNumber: string;
    messageGuid?: string;
  }): Promise<string> {
    myPhoneNumber = userPhoneNumber;

    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes("email") || lowerMessage.includes("inbox") || lowerMessage.includes("mail")) {
      console.log("[Agent] Manual email check requested");
      return await fetchAndSummarizeEmails();
    }

    const history = getHistory(userPhoneNumber);
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: message }
    ];

    try {
      const completion = await openrouter.chat.completions.create({
        model: "anthropic/claude-haiku-4.5",
        messages,
        max_tokens: 256,
      });

      const response = completion.choices[0]?.message?.content || "hmm let me think";
      addMessage(userPhoneNumber, "user", message);
      addMessage(userPhoneNumber, "assistant", response);
      return response;
    } catch (error) {
      console.error("Error:", error);
      return "something went wrong, try again?";
    }
  }
};