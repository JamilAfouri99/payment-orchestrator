"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  getMe,
  login as apiLogin,
  setToken,
  clearToken,
  type AuthUser,
  type AuthTenant,
} from "@/lib/api";

interface AuthContextValue {
  user: AuthUser | null;
  tenant: AuthTenant | null;
  token: string | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tenant, setTenant] = useState<AuthTenant | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    const stored =
      typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
    if (!stored) {
      setUser(null);
      setTenant(null);
      setTokenState(null);
      setIsLoading(false);
      return;
    }
    try {
      const { user: u, tenant: t } = await getMe();
      setUser(u);
      setTenant(t);
      setTokenState(stored);
    } catch {
      // Token is invalid or expired — clear it
      clearToken();
      setUser(null);
      setTenant(null);
      setTokenState(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password);
    setToken(res.token);
    setTokenState(res.token);
    setUser(res.user);
    // Fetch full tenant data after login
    const { tenant: t } = await getMe();
    setTenant(t);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setTenant(null);
    setTokenState(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        tenant,
        token,
        isLoggedIn: user !== null,
        isLoading,
        login,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
