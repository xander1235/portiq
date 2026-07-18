export type Tone = "success" | "warn" | "error" | "info" | "muted";

export function toneColor(tone: Tone): string {
  switch (tone) {
    case "success": return "var(--accent-2)";
    case "warn": return "var(--accent-yellow)";
    case "error": return "var(--danger)";
    case "info": return "var(--accent-blue)";
    case "muted": return "var(--muted)";
  }
}
