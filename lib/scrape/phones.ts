// Phone numbers a site really shows, pulled in code so the extraction can
// only pick from them (the same closed-candidate rule as colors and logos).
// No "server-only": pure string work, shared by the scraper and its tests.

// A separator before the last four digits is required, so order numbers and
// prices don't read as phones. Area codes and exchanges start at 2.
const US_PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-](\d{4})\b/g;

/** The digits of a phone, without a leading US country code. */
export function phoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

/** "2145550101" → "(214) 555-0101"; anything that isn't a US number keeps
 * its own formatting. */
export function formatPhone(raw: string): string {
  const digits = phoneDigits(raw);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits)
    ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
    : raw.trim();
}

/** tel: links first (the number the site wants dialed), then US numbers
 * in the page text, deduped by digits, at most 3. */
export function phoneCandidates(telHrefs: string[], text: string): string[] {
  const out = new Map<string, string>();
  const add = (raw: string) => {
    const digits = phoneDigits(raw);
    if (digits.length < 7 || digits.length > 15 || out.has(digits)) return;
    out.set(digits, formatPhone(raw));
  };
  for (const href of telHrefs) {
    let value = href.replace(/^tel:/i, "").split(/[?;]/)[0];
    try {
      value = decodeURIComponent(value);
    } catch {
      // A malformed escape: the raw value still has the digits.
    }
    add(value);
  }
  for (const m of text.matchAll(US_PHONE_RE)) add(`${m[1]}${m[2]}${m[3]}`);
  return [...out.values()].slice(0, 3);
}

/** The extraction's phone, kept only when it's one of the candidates (by
 * digits), in the candidate's display form. */
export function pickPhone(raw: string | undefined, candidates: string[]): string | undefined {
  const digits = raw ? phoneDigits(raw) : "";
  if (!digits) return undefined;
  return candidates.find((c) => phoneDigits(c) === digits);
}
