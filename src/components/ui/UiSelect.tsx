import * as RS from "@radix-ui/react-select";
import styles from "./ui.module.css";

export type Option = { value: string; label: string; color?: string };
export function Select({ value, options, onChange, placeholder }: {
  value: string; options: Option[]; onChange: (v: string) => void; placeholder?: string;
}) {
  const active = options.find((o) => o.value === value);
  return (
    <RS.Root value={value} onValueChange={onChange}>
      <RS.Trigger className={styles.selectTrigger} aria-label={placeholder ?? "Select"}>
        <RS.Value placeholder={placeholder}>
          <span style={active?.color ? { color: active.color, fontWeight: 700 } : undefined}>{active?.label ?? placeholder}</span>
        </RS.Value>
        <RS.Icon className={styles.selectCaret}>▾</RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content className={styles.selectContent} position="popper" sideOffset={4}>
          <RS.Viewport>
            {options.map((o) => (
              <RS.Item key={o.value} value={o.value} className={styles.selectItem}>
                <RS.ItemText><span style={o.color ? { color: o.color, fontWeight: 700 } : undefined}>{o.label}</span></RS.ItemText>
              </RS.Item>
            ))}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  );
}
