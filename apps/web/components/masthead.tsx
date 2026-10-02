import { signOutAction } from "@/app/odjava/actions";
import { createServerComponentSupabase } from "@/lib/supabase/server";

export async function Masthead() {
  const supabase = await createServerComponentSupabase();
  const auth = await supabase.auth.getUser();

  return (
    <header className="masthead">
      <div className="masthead__inner">
        <a className="wordmark" href="/">
          Dinar po dinar
        </a>
        {auth.data.user ? (
          <form action={signOutAction}>
            <button className="button button--quiet button--small" type="submit">
              Odjavi se
            </button>
          </form>
        ) : null}
      </div>
    </header>
  );
}
