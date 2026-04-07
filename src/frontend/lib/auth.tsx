import {
    createContext,
    useContext,
    useState,
    useCallback,
    useEffect,
    type ReactNode,
} from 'react';
import {
    login as apiLogin,
    logout as apiLogout,
    getSession,
    type LoginResponse,
} from './api';

interface SessionState {
    username: string;
    expiresAt: string;
}

interface AuthContextValue {
    username: string | null;
    isAuthenticated: boolean;
    authLoading: boolean;
    login: (username: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<SessionState | null>(null);
    const [authLoading, setAuthLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        getSession()
            .then((data) => {
                if (!cancelled) {
                    setSession({
                        username: data.username,
                        expiresAt: data.expiresAt,
                    });
                }
            })
            .catch(() => {
                if (!cancelled) setSession(null);
            })
            .finally(() => {
                if (!cancelled) setAuthLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!session) return;
        const ms = new Date(session.expiresAt).getTime() - Date.now();
        if (ms <= 0) {
            setSession(null);
            return;
        }
        const timer = setTimeout(() => {
            setSession(null);
        }, ms);
        return () => clearTimeout(timer);
    }, [session]);

    const login = useCallback(async (username: string, password: string) => {
        const res: LoginResponse = await apiLogin(username, password);
        setSession({
            username: res.username,
            expiresAt: res.expiresAt,
        });
    }, []);

    const logout = useCallback(async () => {
        try {
            await apiLogout();
        } finally {
            setSession(null);
        }
    }, []);

    return (
        <AuthContext.Provider
            value={{
                username: session?.username ?? null,
                isAuthenticated: session !== null,
                authLoading,
                login,
                logout,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return ctx;
}
