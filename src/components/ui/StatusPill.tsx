import { statusMeta } from "./statusMeta";
import { toneColor } from "./tone";
import styles from "./ui.module.css";

export function StatusPill({ status }: { status: number | "error" | "pending" | null }) {
  const { label, tone } = statusMeta(status);
  const color = toneColor(tone);
  return (
    <span className={styles.statusPill} style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
      {label}
    </span>
  );
}
