/** Split a template string into literal and {{...}} reference segments (in order). */
export function splitTemplate(s: string): { ref: boolean; text: string }[] {
  const out: { ref: boolean; text: string }[] = [];
  if (!s) return out;
  const re = /\{\{[\s\S]*?\}\}/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ ref: false, text: s.slice(last, m.index) });
    out.push({ ref: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ ref: false, text: s.slice(last) });
  return out;
}
