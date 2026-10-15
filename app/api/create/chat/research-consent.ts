// Web research spends real money, so a campaign only researches when the
// owner said so in their own words. The agent is told to ask; this is the
// backstop for when it sets research without a clear yes.

const SAYS_RESEARCH = /\bresearch/i;
const DECLINES =
  /\b(no|don'?t|do not|skip|without|not)\b[^.?!]{0,30}\bresearch|\bresearch\b[^.?!]{0,20}\b(no|not needed|skip)\b/i;

/** True when the latest user message that mentions research asks for it. */
export function userAskedForResearch(userMessages: string[]): boolean {
  for (let i = userMessages.length - 1; i >= 0; i--) {
    const text = userMessages[i];
    if (!SAYS_RESEARCH.test(text)) continue;
    return !DECLINES.test(text);
  }
  return false;
}
