import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/auth';
import { Toaster } from '@/components/ui/sonner';
import { AdminLayout } from '@/pages/admin/layout';
import { LoginPage } from '@/pages/admin/login';
import { PresentationsPage } from '@/pages/admin/presentations';
import { PresentationDetailPage } from '@/pages/admin/presentation-detail';
import { ViewerPasswordPage } from '@/pages/viewer/password';
import { ViewerPresentPage } from '@/pages/viewer/present';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 1,
            refetchOnWindowFocus: false,
        },
    },
});

export function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <AuthProvider>
                <BrowserRouter>
                    <Routes>
                        <Route path="/admin/login" element={<LoginPage />} />
                        <Route path="/admin" element={<AdminLayout />}>
                            <Route index element={<PresentationsPage />} />
                            <Route
                                path="presentations/:id"
                                element={<PresentationDetailPage />}
                            />
                        </Route>
                        <Route
                            path="/view/:slug"
                            element={<ViewerPasswordPage />}
                        />
                        <Route
                            path="/view/:slug/present"
                            element={<ViewerPresentPage />}
                        />
                        <Route
                            path="*"
                            element={<Navigate to="/admin" replace />}
                        />
                    </Routes>
                </BrowserRouter>
                <Toaster />
            </AuthProvider>
        </QueryClientProvider>
    );
}
