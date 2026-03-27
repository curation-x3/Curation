import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
} from "react";
import { setAuthToken } from "./api";

export interface AppUser {
  id: number;
  authing_sub?: string;
  email: string;
  username: string;
  role: "admin" | "user";
}

export type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; user: AppUser; token: string };

type Action =
  | { type: "LOGIN"; user: AppUser; token: string }
  | { type: "LOGOUT" }
  | { type: "LOADED_UNAUTHENTICATED" };

function reducer(_state: AuthState, action: Action): AuthState {
  switch (action.type) {
    case "LOGIN":
      return { status: "authenticated", user: action.user, token: action.token };
    case "LOGOUT":
      return { status: "unauthenticated" };
    case "LOADED_UNAUTHENTICATED":
      return { status: "unauthenticated" };
  }
}

const SESSION_KEY = "curation_auth";

interface AuthContextValue {
  state: AuthState;
  login: (token: string, user: AppUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { status: "loading" });

  useEffect(() => {
    // Restore session from sessionStorage
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const { token, user } = JSON.parse(raw);
        setAuthToken(token);
        dispatch({ type: "LOGIN", user, token });
        return;
      }
    } catch {
      // ignore
    }
    dispatch({ type: "LOADED_UNAUTHENTICATED" });
  }, []);

  useEffect(() => {
    const handler = () => {
      sessionStorage.removeItem(SESSION_KEY);
      setAuthToken(null);
      dispatch({ type: "LOGOUT" });
    };
    window.addEventListener("auth:expired", handler);
    return () => window.removeEventListener("auth:expired", handler);
  }, []);

  const login = useCallback((token: string, user: AppUser) => {
    setAuthToken(token);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, user }));
    dispatch({ type: "LOGIN", user, token });
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    sessionStorage.removeItem(SESSION_KEY);
    dispatch({ type: "LOGOUT" });
  }, []);

  return (
    <AuthContext.Provider value={{ state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
