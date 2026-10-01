import type { ReactNode } from "react";

export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint ? (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Notice({
  tone = "bad",
  children,
}: {
  tone?: "bad" | "good";
  children: ReactNode;
}) {
  return (
    <p className={`notice notice--${tone}`} role={tone === "bad" ? "alert" : "status"}>
      {children}
    </p>
  );
}
