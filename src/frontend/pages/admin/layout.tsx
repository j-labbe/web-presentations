import { Navigate, Outlet, Link, useLocation } from 'react-router';
import { motion } from 'motion/react';
import { useAuth } from '@/lib/auth';
import { transitions } from '@/lib/motion';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { LayoutDashboard, LogOut } from 'lucide-react';

export function AdminLayout() {
    const { isAuthenticated, username, logout, authLoading } = useAuth();
    const location = useLocation();

    if (authLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <p className="text-sm text-muted-foreground">Loading…</p>
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/admin/login" replace />;
    }

    return (
        <div className="flex min-h-screen flex-col">
            <motion.header
                className="sticky top-0 z-40 border-b bg-background"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={transitions.header}
            >
                <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
                    <nav className="flex items-center gap-4">
                        <Link
                            to="/admin"
                            className="flex items-center gap-2 font-semibold"
                        >
                            <LayoutDashboard className="h-5 w-5" />
                            <span>Presentations</span>
                        </Link>
                    </nav>
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground">
                            {username}
                        </span>
                        <Separator orientation="vertical" className="h-5" />
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => logout()}
                        >
                            <LogOut className="mr-1 h-4 w-4" />
                            Logout
                        </Button>
                    </div>
                </div>
            </motion.header>
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
                <motion.div
                    key={location.pathname}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={transitions.page}
                >
                    <Outlet />
                </motion.div>
            </main>
        </div>
    );
}
