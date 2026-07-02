import { google } from "@ai-sdk/google";

// One place for the AI config. We use Google Gemini directly (free tier, no
// card) via @ai-sdk/google, which reads GOOGLE_GENERATIVE_AI_API_KEY from the
// env. gemini-2.0-flash has a much more generous free tier than 2.5-flash
// (~15 req/min and 1,500/day vs 250) — important because the agent loop makes
// multiple model calls per turn. Swap the model id here to change models.
export const CHAT_MODEL_ID = "gemini-2.0-flash";
export const chatModel = google(CHAT_MODEL_ID);

/** Default per-user model-requests/day cap (owner bypasses). */
export const DAILY_REQUEST_CAP = 250;

/** Allowlisted emails that bypass the cap entirely (TDD §7). */
export const OWNER_EMAILS = ["guoxuan.xu8@gmail.com"];

/** Trailing UIMessages sent to the model each turn (TDD §6.1). */
export const CONTEXT_WINDOW = 20;
