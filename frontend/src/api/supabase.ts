import { createClient } from "@supabase/supabase-js";
import { storedSessionUsable } from "./session";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY");
}

const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;

function authStorage() {
  return {
    getItem(key: string) {
      const raw = localStorage.getItem(key);
      if (key !== storageKey || raw == null) return raw;
      if (storedSessionUsable(raw)) return raw;
      localStorage.removeItem(key);
      return null;
    },
    setItem(key: string, value: string) {
      if (key === storageKey && !storedSessionUsable(value)) {
        localStorage.removeItem(key);
        return;
      }
      localStorage.setItem(key, value);
    },
    removeItem(key: string) {
      localStorage.removeItem(key);
    },
  };
}

export const supabase = createClient(url, key, {
  auth: {
    storageKey,
    storage: authStorage(),
  },
});

export const TEACHER_APPLY_EMAIL = "lms_teacher_apply_email";
