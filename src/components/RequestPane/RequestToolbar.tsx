import React from "react";
import { MethodSelect } from "./MethodSelect";
import { Button } from "../ui/AppButton";
import styles from "./RequestToolbar.module.css";

export function RequestToolbar(props: {
  method: string; onMethodChange: (m: string) => void;
  sending: boolean; onSend: () => void; onCancel: () => void;
  urlField: React.ReactNode; // the existing <EnvInput/> element, passed in from RequestEditor to avoid re-threading its ~10 props
}) {
  const { method, onMethodChange, sending, onSend, onCancel, urlField } = props;
  return (
    <div className={styles.bar}>
      <div className={styles.pill}>
        <div className={styles.methodSeg}><MethodSelect value={method} onChange={onMethodChange} /></div>
        <div className={styles.urlSeg}>{urlField}</div>
      </div>
      {sending
        ? <Button variant="danger" onClick={onCancel}>Cancel</Button>
        : <Button variant="primary" onClick={onSend}>Send</Button>}
    </div>
  );
}
