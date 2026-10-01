"use client";

import { useFormStatus } from "react-dom";

/**
 * Dugme koje se samo zaključa dok akcija traje, pa drugi klik ne šalje isti
 * zahtev još jednom. `quiet` je tiša varijanta za sporedne radnje u istom redu.
 */
export function SubmitButton({
  children,
  pendingLabel,
  quiet = false,
}: {
  children: string;
  pendingLabel: string;
  quiet?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={quiet ? "button button--quiet" : "button"}
      disabled={pending}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
