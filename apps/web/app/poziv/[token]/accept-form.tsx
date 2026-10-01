"use client";

import { useActionState } from "react";

import { Notice } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";

import { acceptInvitationAction } from "./actions";
import { emptyInvitationState } from "./state";

export function AcceptForm({ token }: { token: string }) {
  const [state, action] = useActionState(acceptInvitationAction, emptyInvitationState);

  return (
    <form className="stack stack--loose" action={action}>
      <input type="hidden" name="token" value={token} />

      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}

      <div className="row">
        <SubmitButton pendingLabel="Prihvatam…">Prihvati pozivnicu</SubmitButton>
        <a className="button button--quiet" href="/">
          Ne sada
        </a>
      </div>
    </form>
  );
}
