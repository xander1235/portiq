import { SegmentedControl } from "../ui/SegmentedControl";

export function RequestTabs({ active, tabs, onChange }: { active: string; tabs: string[]; onChange: (t: string) => void }) {
  return <SegmentedControl bare value={active} onChange={onChange} options={tabs.map((t) => ({ value: t, label: t }))} />;
}
