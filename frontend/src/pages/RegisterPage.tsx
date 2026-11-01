import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { supabase, TEACHER_APPLY_EMAIL } from "../api/supabase";
import { buttonClass, ErrorNote, fieldClass, labelClass, PageHeader } from "../components/ui";

export function RegisterPage() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountType, setAccountType] = useState<"student" | "teacher">("student");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setInfo(null);
    const normalized = email.trim().toLowerCase();
    if (accountType === "teacher") localStorage.setItem(TEACHER_APPLY_EMAIL, normalized);
    else localStorage.removeItem(TEACHER_APPLY_EMAIL);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: normalized,
      password,
      options: { data: { full_name: fullName.trim() } },
    });
    setPending(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    if (!data.session) {
      setInfo("Confirm your email, then log in. This project may require email confirmation before a session exists.");
      return;
    }
    navigate(accountType === "teacher" ? "/teach" : "/learn");
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="Register" lede="Your account starts as a student. A teacher choice is a request, not a role." />
      <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
        <label className={labelClass}>
          Full name
          <input className={fieldClass} autoComplete="name" required value={fullName} onChange={(event) => setFullName(event.target.value)} />
        </label>
        <label className={labelClass}>
          Email
          <input className={fieldClass} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className={labelClass}>
          Password
          <input className={fieldClass} type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <fieldset className="space-y-2">
          <legend className={labelClass}>Account type</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="account-type" checked={accountType === "student"} onChange={() => setAccountType("student")} />
            Student
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="account-type" checked={accountType === "teacher"} onChange={() => setAccountType("teacher")} />
            Teacher
          </label>
          <p className="text-sm text-zinc-600">
            Teacher accounts stay pending until an admin approves them. This choice is not sent as authorization metadata.
          </p>
        </fieldset>
        {error ? <ErrorNote message={error} /> : null}
        {info ? <p className="text-sm text-zinc-700">{info}</p> : null}
        <button type="submit" className={buttonClass} disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-sm text-zinc-600">
        Already registered? <Link to="/login" className="text-blue-800 underline">Log in</Link>
      </p>
    </div>
  );
}
