import { usableAccessToken } from "./session";
import { supabase } from "./supabase";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function detailMessage(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          const record = item as { msg: unknown; loc?: unknown[] };
          const loc = Array.isArray(record.loc)
            ? record.loc.filter((part) => part !== "body").join(".")
            : "";
          return loc ? `${loc}: ${String(record.msg)}` : String(record.msg);
        }
        return String(item);
      })
      .join(" ");
  }
  return "Request failed";
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string | null,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let token = accessToken;
  if (token === undefined) {
    try {
      const { data, error } = await supabase.auth.getSession();
      token = error ? null : usableAccessToken(data.session);
    } catch {
      token = null;
    }
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as { detail?: unknown }) : {};
  if (!response.ok) {
    throw new ApiError(response.status, detailMessage(payload.detail));
  }
  return payload as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
