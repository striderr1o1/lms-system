import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { supabase } from "../api/supabase";
import { buttonClass, ErrorNote, fieldClass, labelClass, PageHeader } from "../components/ui";

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setPending(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    const next = params.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) navigate(next);
    else navigate("/");
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="Log in" lede="Use the email and password from your Supabase account." />
      <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
        <label className={labelClass}>
          Email
          <input className={fieldClass} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className={labelClass}>
          Password
          <input className={fieldClass} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <ErrorNote message={error} /> : null}
        <button type="submit" className={buttonClass} disabled={pending}>
          {pending ? "Signing in…" : "Log in"}
        </button>
      </form>
      <p className="mt-4 text-sm text-zinc-600">
        No account? <Link to="/register" className="text-blue-800 underline">Register</Link>
      </p>
    </div>
  );
}
