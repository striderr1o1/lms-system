const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "");

interface TokenSession {
  access_token?: string | null;
  refresh_token?: string | null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part || token.split(".").length !== 3) return null;
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!payload || typeof payload !== "object") return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

function projectJwt(token: string): Record<string, unknown> | null {
  const payload = decodeJwtPayload(token);
  if (!payload || !supabaseUrl) return null;
  if (payload.iss !== `${supabaseUrl}/auth/v1`) return null;
  const audience = payload.aud;
  const audienceOk =
    audience === "authenticated" ||
    (Array.isArray(audience) && audience.includes("authenticated"));
  if (!audienceOk) return null;
  return payload;
}

export function storedSessionUsable(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as TokenSession;
    if (!parsed.refresh_token || !parsed.access_token) return false;
    return projectJwt(parsed.access_token) !== null;
  } catch {
    return false;
  }
}

export function sessionAcceptance(session: TokenSession | null | undefined): "use" | "drop" | "wait" {
  const token = session?.access_token;
  if (!token || !session?.refresh_token) return "drop";
  const payload = projectJwt(token);
  if (!payload) return "drop";
  if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) return "wait";
  return "use";
}

export function usableAccessToken(session: TokenSession | null | undefined): string | null {
  if (sessionAcceptance(session) !== "use") return null;
  return session?.access_token ?? null;
}
