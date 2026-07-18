import styles from "./ui.module.css";

export function SegmentedControl({ value, options, onChange, size = "md" }: {
  value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; size?: "sm" | "md";
}) {
  return (
    <div className={[styles.segmented, size === "sm" ? styles.segmentedSm : ""].filter(Boolean).join(" ")} role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value}
          className={[styles.segment, o.value === value ? styles.segmentOn : ""].filter(Boolean).join(" ")}
          onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
