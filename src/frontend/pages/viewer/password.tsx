import { useState, useEffect, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { lookupSlug, unlockPresentation, ApiError } from '@/lib/api';
import { transitions } from '@/lib/motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Lock } from 'lucide-react';

export function ViewerPasswordPage() {
    const { slug } = useParams<{ slug: string }>();
    const navigate = useNavigate();

    const [presentationId, setPresentationId] = useState('');
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    const [password, setPassword] = useState('');
    const [unlocking, setUnlocking] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!slug) return;
        lookupSlug(slug)
            .then((data) => {
                setPresentationId(data.id);
                setLoading(false);
            })
            .catch(() => {
                setNotFound(true);
                setLoading(false);
            });
    }, [slug]);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        if (!presentationId || !password) return;

        setError('');
        setUnlocking(true);

        try {
            const res = await unlockPresentation(presentationId, password);
            sessionStorage.setItem(
                `viewer_session_${slug}`,
                JSON.stringify({
                    presentationId,
                    expiresAt: res.expiresAt,
                })
            );
            navigate(`/view/${slug}/present`, { replace: true });
        } catch (err) {
            if (err instanceof ApiError) {
                if (err.status === 429) {
                    setError('Too many attempts. Please try again later.');
                } else {
                    setError('Incorrect password');
                }
            } else {
                setError('An unexpected error occurred');
            }
        } finally {
            setUnlocking(false);
        }
    }

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center px-4">
                <Card className="w-full max-w-sm">
                    <CardHeader>
                        <Skeleton className="h-6 w-48" />
                        <Skeleton className="h-4 w-32 mt-2" />
                    </CardHeader>
                    <CardContent>
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-9 w-full mt-4" />
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (notFound) {
        return (
            <div className="flex min-h-screen items-center justify-center px-4">
                <Card className="w-full max-w-sm">
                    <CardHeader>
                        <CardTitle>Not Found</CardTitle>
                        <CardDescription>
                            This presentation does not exist.
                        </CardDescription>
                    </CardHeader>
                </Card>
            </div>
        );
    }

    return (
        <motion.div
            className="flex min-h-screen items-center justify-center px-4"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transitions.page}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={transitions.card}
            >
                <Card className="w-full max-w-sm">
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <Lock className="h-5 w-5 text-muted-foreground" />
                            <CardTitle>{slug}</CardTitle>
                        </div>
                        <CardDescription>
                            Enter the password to view this presentation
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="viewer-password">
                                    Password
                                </Label>
                                <Input
                                    id="viewer-password"
                                    type="password"
                                    value={password}
                                    onChange={(e) =>
                                        setPassword(e.target.value)
                                    }
                                    required
                                    autoFocus
                                    autoComplete="off"
                                />
                            </div>
                            {error && (
                                <p className="text-sm text-destructive">
                                    {error}
                                </p>
                            )}
                            <Button
                                type="submit"
                                className="w-full"
                                disabled={unlocking}
                            >
                                {unlocking
                                    ? 'Unlocking...'
                                    : 'View Presentation'}
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </motion.div>
        </motion.div>
    );
}
