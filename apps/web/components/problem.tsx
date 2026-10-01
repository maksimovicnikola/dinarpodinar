import { Notice } from "./form";
import { Passbook, PassbookHeader } from "./passbook";

/**
 * Vidljiv zastoj umesto prazne strane.
 *
 * Prazan mesec i mesec koji nije stigao izgledaju isto ako se greška prećuti,
 * pa svaka strana koja čita podatke ima ovaj izlaz: šta se desilo, šta sledeće,
 * i jedan link nazad.
 */
export function Problem({
  title,
  lead,
  children,
  backHref = "/",
  backLabel = "Na početnu",
}: {
  title: string;
  lead: string;
  children: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <Passbook>
      <PassbookHeader eyebrow="Zastoj" title={title} lead={lead} />
      <div className="stack stack--loose">
        <Notice tone="bad">{children}</Notice>
        <div className="row">
          <a className="button button--quiet" href={backHref}>
            {backLabel}
          </a>
        </div>
      </div>
    </Passbook>
  );
}
