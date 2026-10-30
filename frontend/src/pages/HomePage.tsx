import { Link } from "react-router";
import { buttonClass, buttonSecondaryClass } from "../components/ui";
import { useAuth } from "../hooks/AuthProvider";
import { useMe } from "../hooks/useMe";

export function HomePage() {
  const { session } = useAuth();
  const me = useMe();
  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-950">LMS</h1>
        <p className="mt-2 text-zinc-700">
          Browse published courses, study the lessons you enrolled in, or build a course after an admin approves you as a teacher.
        </p>
      </header>
      <div className="flex flex-wrap gap-3">
        <Link to="/courses" className={buttonClass}>
          Browse courses
        </Link>
        {session ? (
          <Link to="/learn" className={buttonSecondaryClass}>
            Your learning
          </Link>
        ) : (
          <Link to="/register" className={buttonSecondaryClass}>
            Create an account
          </Link>
        )}
        {me.data?.role === "teacher" ? (
          <Link to="/teach" className={buttonSecondaryClass}>
            Teach
          </Link>
        ) : null}
        {me.data?.role === "admin" ? (
          <Link to="/admin" className={buttonSecondaryClass}>
            Admin
          </Link>
        ) : null}
      </div>
    </div>
  );
}
