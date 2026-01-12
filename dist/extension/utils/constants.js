/** Storage keys */
export const STORAGE_KEYS = {
    ANALYTICS: "apg_analytics",
};
/** Supported AI hosts for analytics labeling / display */
export const SUPPORTED_HOSTS = [
    "chat.openai.com",
    "claude.ai",
    "gemini.google.com",
    "www.perplexity.ai",
];
/** UI limits */
export const UI_LIMITS = {
    MAX_TOP_HOSTS: 8,
    MAX_TOP_CATEGORIES: 10,
    MAX_DAILY_POINTS: 14, // last N days
};
/** File download metadata */
export const EXPORT = {
    FILENAME_PREFIX: "apg-analytics",
};
