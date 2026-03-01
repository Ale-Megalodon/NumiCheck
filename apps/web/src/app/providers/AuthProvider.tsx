import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { User } from "firebase/auth";
import { onAuthStateChanged } from "firebase/auth";
import { firebaseAuth } from "../../shared/config/firebase";
import { signInWithFacebook, signInWithGoogle, signOutUser } from "../../modules/auth/services/auth.service";
import { upsertAdminUserFromAuth } from "../../modules/admin/services/adminUsersStore";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  loginWithFacebook: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Avoid blank/blocked states if auth listeners fail in hostile networks.
    const failSafeTimer = window.setTimeout(() => {
      setLoading(false);
    }, 5000);

    const unsubscribe = onAuthStateChanged(
      firebaseAuth,
      (nextUser) => {
        setUser(nextUser);
        if (nextUser) {
          upsertAdminUserFromAuth(nextUser);
        }
        setLoading(false);
        window.clearTimeout(failSafeTimer);
      },
      () => {
        setUser(null);
        setLoading(false);
        window.clearTimeout(failSafeTimer);
      }
    );

    return () => {
      window.clearTimeout(failSafeTimer);
      unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      loginWithGoogle: signInWithGoogle,
      loginWithFacebook: signInWithFacebook,
      logout: signOutUser
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
