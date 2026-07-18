import styles from "./ui.module.css";

export function SegmentedControl({ value, options, onChange, size = "md", bare = false }: {
  value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; size?: "sm" | "md"; bare?: boolean;
}) {
  return (
    <div className={[styles.segmented, size === "sm" ? styles.segmentedSm : "", bare ? styles.segmentedBare : ""].filter(Boolean).join(" ")} role="tablist">
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
