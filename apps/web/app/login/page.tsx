import { loginErrorMessage } from "@/lib/auth-messages";
import { firstParam, nextPathOrDefault } from "@/lib/next-path";

import { LoginForm } from "./login-form";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  return (
    <LoginForm
      nextPath={nextPathOrDefault(firstParam(params.next))}
      notice={loginErrorMessage(firstParam(params.greska))}
    />
  );
}
