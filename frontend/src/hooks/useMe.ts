import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Profile } from "../api/types";
import { useAuth } from "./AuthProvider";

export function useMe() {
  const { session, ready } = useAuth();
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<Profile>("/api/v1/me"),
    enabled: ready && !!session,
  });
}
