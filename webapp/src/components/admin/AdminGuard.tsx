import { useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "../../lib/auth";

/** Пропускает в админ-экраны только `profile.isAdmin`; иначе редиректит на «Общее». */
export function AdminGuard({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (profile && !profile.isAdmin) {
      navigate({ href: "/general", replace: true });
    }
  }, [profile, navigate]);

  if (!profile?.isAdmin) return null;

  return <>{children}</>;
}
