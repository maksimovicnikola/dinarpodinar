import { loginErrorMessage } from "@/lib/auth-messages";
import { needsDisplayName } from "@/lib/display-name";
import { firstParam, nextPathOrDefault } from "@/lib/next-path";
import { createServerComponentSupabase } from "@/lib/supabase/server";

import { LoginForm } from "./login-form";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createServerComponentSupabase();
  const auth = await supabase.auth.getUser();
  const askName = firstParam(params.ime) === "1" && needsDisplayName(auth.data.user?.user_metadata);

  return (
    <LoginForm
      nextPath={nextPathOrDefault(firstParam(params.next))}
      notice={loginErrorMessage(firstParam(params.greska))}
      askName={askName}
    />
  );
}
