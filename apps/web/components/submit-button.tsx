"use client";

import { useFormStatus } from "react-dom";

/**
 * Dugme koje se samo zaključa dok akcija traje, pa drugi klik ne šalje isti
 * zahtev još jednom. `quiet` je tiša varijanta za sporedne radnje u istom redu.
 *
 * `disabled` dodaje razlog koji dugme ne može samo da vidi: nepotvrđeno
 * brisanje ili forma koja nema šta da izabere. Zaključavanje dok akcija traje
 * ostaje bezuslovno, pa prosleđen `false` ništa ne otključava.
 */
export function SubmitButton({
  children,
  pendingLabel,
  quiet = false,
  disabled = false,
}: {
  children: string;
  pendingLabel: string;
  quiet?: boolean;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={quiet ? "button button--quiet" : "button"}
      disabled={pending || disabled}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
