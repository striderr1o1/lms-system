import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { usableAccessToken } from "../api/session";
import type { Profile } from "../api/types";
import { useAuth } from "./AuthProvider";

export function useMe() {
  const { session, ready } = useAuth();
  const token = usableAccessToken(session);
  return useQuery({
    queryKey: ["me", token],
    queryFn: () => api<Profile>("/api/v1/me", {}, token),
    enabled: ready && !!token,
    retry: false,
  });
}
