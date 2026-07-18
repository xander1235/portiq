import { ButtonHTMLAttributes } from "react";
import styles from "./ui.module.css";

type Variant = "primary" | "ghost" | "danger";
export function Button({ variant = "primary", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...rest} className={[styles.btn, styles[`btn_${variant}`], className].filter(Boolean).join(" ")} />;
}
