import type { ReactNode } from "react";

/** Potpisni motiv: linijar tekućeg salda. Jedini ukras u aplikaciji. */
export function Ruler() {
  return <hr className="ruler" aria-hidden="true" />;
}

export function Passbook({ children }: { children: ReactNode }) {
  return <section className="passbook">{children}</section>;
}

export function PassbookHeader({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: string;
  lead?: ReactNode;
}) {
  return (
    <header className="passbook__head">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {lead ? <p className="lead">{lead}</p> : null}
      <Ruler />
    </header>
  );
}
