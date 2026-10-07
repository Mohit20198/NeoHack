/**
 * groqExtract.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Groq LLM fallback for extracting company/CTC info from CDC emails that
 * fail the regex parser in gmailSync.js.
 *
 * Called only when extractCompanyFromSubject() returns null.
 * Returns { companyName, ctc, confidence } where confidence is:
 *   'high'   → auto-write to Placement (regex-equivalent trust)
 *   'medium' → route to admin PendingReview queue
 *   'low'    → route to admin PendingReview queue (likely not a placement email)
 *
 * On any error (quota, network, bad JSON) returns a safe low-confidence
 * default so the caller can route to review rather than crash.
 */

require('dotenv').config();
const Groq = require('groq-sdk');

let groq = null;

function getGroqClient() {
  if (!groq) {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is not set in .env');
    }
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groq;
}

/**
 * @param {string} subject      - Email subject line
 * @param {string} bodySnippet  - Raw email body text (sliced to 1000 chars inside)
 * @returns {{ companyName: string|null, ctc: string|null, confidence: 'high'|'medium'|'low' }}
 */
async function extractWithGroq(subject, bodySnippet) {
  const prompt = `Extract placement details from this CDC email.
Return ONLY valid JSON, no markdown, no explanation.

Subject: ${subject}
Body: ${bodySnippet.slice(0, 1000)}

Return exactly this shape:
{
  "companyName": string or null,
  "ctc": string or null,
  "confidence": "high" | "medium" | "low"
}

Rules:
- companyName: the hiring company's name only, no suffixes like "Pvt Ltd" unless part of common usage
- ctc: the compensation figure as written (e.g. "12 LPA", "45000/month"), or null if not mentioned
- confidence: "low" if the email doesn't clearly look like a placement confirmation at all`;

  try {
    const client = getGroqClient();
    const completion = await client.chat.completions.create({
      model: 'openai/gpt-oss-20b',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(completion.choices[0].message.content);

    // Validate shape — guard against malformed LLM output
    const confidence = ['high', 'medium', 'low'].includes(parsed.confidence)
      ? parsed.confidence
      : 'low';

    return {
      companyName: typeof parsed.companyName === 'string' ? parsed.companyName.trim() || null : null,
      ctc:         typeof parsed.ctc         === 'string' ? parsed.ctc.trim()         || null : null,
      confidence
    };
  } catch (err) {
    console.error('[groqExtract] failed:', err.message);
    return { companyName: null, ctc: null, confidence: 'low' };
  }
}

module.exports = { extractWithGroq };
