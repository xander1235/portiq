import { Select } from "../ui/UiSelect";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];
const color = (m: string) => `var(--method-${m.toLowerCase()})`;

export function MethodSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Select value={value} onChange={onChange} options={METHODS.map((m) => ({ value: m, label: m, color: color(m) }))} />;
}
