import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

export type UserRole = "sender" | "courier";

/**
 * Fetch helper that attaches the bearer token. Kept here (not in a screen) so
 * every authenticated request goes through one place. Callers pass the token
 * from `useUser()`; a null token simply omits the header.
 */
export async function authedFetch(
  token: string | null,
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export type User = {
  id: string;
  deviceId?: string | null;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  role: UserRole;
  isOnline?: boolean;
  totalDeliveries?: number;
  rating?: number | null;
};

/** Alias kept for screens that import the profile type by this name. */
export type UserProfile = User;

type UserContextValue = {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  updateUser: (patch: Partial<User>) => void;
  logout: () => Promise<void>;
};

const TOKEN_KEY = "porter.session.token";
const USER_KEY = "porter.session.user";

/**
 * Session tokens are secrets. On native we keep them in the OS keychain /
 * keystore via expo-secure-store; only non-sensitive profile data goes to
 * AsyncStorage. On web (no SecureStore) we fall back to AsyncStorage.
 */
const secureAvailable = Platform.OS !== "web";

async function persistToken(token: string | null): Promise<void> {
  if (secureAvailable) {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } else {
    if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  }
}

async function readToken(): Promise<string | null> {
  if (secureAvailable) return SecureStore.getItemAsync(TOKEN_KEY);
  return AsyncStorage.getItem(TOKEN_KEY);
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [user, setUserState] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Hydrate persisted session on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [storedToken, storedUser] = await Promise.all([
          readToken(),
          AsyncStorage.getItem(USER_KEY),
        ]);
        if (cancelled) return;
        if (storedToken) setTokenState(storedToken);
        if (storedUser) setUserState(JSON.parse(storedUser) as User);
      } catch {
        // Corrupt/inaccessible storage — start signed out rather than crash.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setToken = useCallback((next: string | null) => {
    setTokenState(next);
    void persistToken(next);
  }, []);

  const setUser = useCallback((next: User | null) => {
    setUserState(next);
    if (next) void AsyncStorage.setItem(USER_KEY, JSON.stringify(next));
    else void AsyncStorage.removeItem(USER_KEY);
  }, []);

  const updateUser = useCallback((patch: Partial<User>) => {
    setUserState((prev) => {
      if (!prev) return prev;
      const merged = { ...prev, ...patch };
      void AsyncStorage.setItem(USER_KEY, JSON.stringify(merged));
      return merged;
    });
  }, []);

  const logout = useCallback(async () => {
    setUserState(null);
    setTokenState(null);
    await Promise.all([
      persistToken(null),
      AsyncStorage.removeItem(USER_KEY),
    ]);
  }, []);

  return (
    <UserContext.Provider
      value={{ user, token, isLoading, setUser, setToken, updateUser, logout }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return ctx;
}
