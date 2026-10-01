import { redirect } from "next/navigation";

import { Notice } from "@/components/form";
import { Passbook, PassbookHeader } from "@/components/passbook";
import { invitationErrorMessage } from "@/lib/auth-messages";
import { invitationToken, loginPathWithNext } from "@/lib/next-path";
import { createServerSupabase } from "@/lib/supabase/server";

import { AcceptForm } from "./accept-form";

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: rawToken } = await params;
  const token = invitationToken(rawToken);

  if (!token) {
    return (
      <Passbook>
        <PassbookHeader
          eyebrow="Pozivnica"
          title="Link nije ispravan"
          lead="Adresa pozivnice nije u očekivanom obliku."
        />
        <div className="stack stack--loose">
          <Notice tone="bad">{invitationErrorMessage("token")}</Notice>
          <div className="row">
            <a className="button button--quiet" href="/">
              Na početnu
            </a>
          </div>
        </div>
      </Passbook>
    );
  }

  const supabase = await createServerSupabase();
  const auth = await supabase.auth.getUser();

  // Neprijavljen gost prvo ide na prijavu; povratak sa linka vraća ga tačno
  // ovde, pa pozivnica ne mora ponovo da se traži u e-pošti.
  if (!auth.data.user) {
    redirect(loginPathWithNext(`/poziv/${token}`));
  }

  return (
    <Passbook>
      <PassbookHeader
        eyebrow="Pozivnica"
        title="Pridružite se domaćinstvu"
        lead="Pozivnica vredi jednom i samo za adresu e-pošte na koju je poslata."
      />
      <div className="stack stack--loose">
        <p className="fine">
          Prijavljeni ste kao <span className="amount">{auth.data.user.email}</span>.
        </p>
        <AcceptForm token={token} />
      </div>
    </Passbook>
  );
}
