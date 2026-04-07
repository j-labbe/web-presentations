import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { getManifest, type PresentationManifest } from '@/lib/api';
import { transitions } from '@/lib/motion';
import { Skeleton } from '@/components/ui/skeleton';

interface ViewerSession {
    presentationId: string;
    expiresAt: string;
}

const SESSION_KEY_PREFIX = 'viewer_session_';

function loadSession(slug: string): ViewerSession | null {
    try {
        const key = `${SESSION_KEY_PREFIX}${slug}`;
        const raw = sessionStorage.getItem(key);
        if (!raw) return null;
        const session = JSON.parse(raw) as ViewerSession;
        if (
            !session.presentationId ||
            !session.expiresAt ||
            new Date(session.expiresAt) <= new Date()
        ) {
            sessionStorage.removeItem(key);
            return null;
        }
        return session;
    } catch {
        return null;
    }
}

export function ViewerPresentPage() {
    const { slug } = useParams<{ slug: string }>();
    const navigate = useNavigate();
    const [manifest, setManifest] = useState<PresentationManifest | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!slug) return;

        const session = loadSession(slug);
        if (!session) {
            navigate(`/view/${slug}`, { replace: true });
            return;
        }

        getManifest(session.presentationId)
            .then(setManifest)
            .catch(() => {
                setError(
                    'Failed to load presentation. Your session may have expired.'
                );
            });
    }, [slug, navigate]);

    if (error) {
        return (
            <div className="flex min-h-screen items-center justify-center px-4">
                <div className="text-center space-y-4">
                    <p className="text-destructive">{error}</p>
                    <a
                        href={`/view/${slug}`}
                        className="text-sm text-primary underline"
                    >
                        Try again
                    </a>
                </div>
            </div>
        );
    }

    if (!manifest) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <div className="space-y-4 text-center">
                    <Skeleton className="h-8 w-48 mx-auto" />
                    <p className="text-sm text-muted-foreground">
                        Loading presentation...
                    </p>
                </div>
            </div>
        );
    }

    // Use manifest's assetBasePath (app-relative or absolute slides-origin when isolated delivery)
    const base = manifest.assetBasePath.replace(/\/$/, '');
    const iframeSrc = `${base}/${manifest.entryFile}`;

    return (
        <motion.div
            className="h-screen w-screen"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={transitions.page}
        >
            <iframe
                src={iframeSrc}
                className="h-full w-full border-0"
                title={manifest.title}
                sandbox="allow-scripts allow-same-origin"
            />
        </motion.div>
    );
}
