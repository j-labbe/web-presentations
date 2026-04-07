import { useState, type FormEvent } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { transitions } from '@/lib/motion';
import {
    getPresentation,
    updatePresentation,
    deletePresentation,
    listSessions,
    revokeSession,
    ApiError,
    type AccessSession,
} from '@/lib/api';
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
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ArrowLeft, ExternalLink, Trash2, Save, XCircle } from 'lucide-react';

export function PresentationDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();

    const [editTitle, setEditTitle] = useState('');
    const [editPassword, setEditPassword] = useState('');
    const [editing, setEditing] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);

    const { data: presentation, isLoading } = useQuery({
        queryKey: ['presentation', id],
        queryFn: () => getPresentation(id!),
        enabled: isAuthenticated && !!id,
        select: (data) => {
            // Initialize edit fields on first load
            if (!editing && editTitle === '') {
                setEditTitle(data.title);
            }
            return data;
        },
    });

    const { data: sessionsData } = useQuery({
        queryKey: ['sessions', id],
        queryFn: () => listSessions(id!),
        enabled: isAuthenticated && !!id,
    });

    const updateMutation = useMutation({
        mutationFn: (data: { title?: string; password?: string }) =>
            updatePresentation(id!, data),
        onSuccess: () => {
            toast.success('Presentation updated');
            queryClient.invalidateQueries({
                queryKey: ['presentation', id],
            });
            queryClient.invalidateQueries({ queryKey: ['presentations'] });
            setEditing(false);
            setEditPassword('');
        },
        onError: (err: Error) => toast.error(err.message),
    });

    const deleteMutation = useMutation({
        mutationFn: () => deletePresentation(id!),
        onSuccess: () => {
            toast.success('Presentation deleted');
            queryClient.invalidateQueries({ queryKey: ['presentations'] });
            navigate('/admin', { replace: true });
        },
        onError: (err: Error) => toast.error(err.message),
    });

    const revokeMutation = useMutation({
        mutationFn: (sessionId: string) => revokeSession(id!, sessionId),
        onSuccess: () => {
            toast.success('Session revoked');
            queryClient.invalidateQueries({ queryKey: ['sessions', id] });
            queryClient.invalidateQueries({
                queryKey: ['presentation', id],
            });
        },
        onError: (err: Error) => toast.error(err.message),
    });

    function handleSave(e: FormEvent) {
        e.preventDefault();
        const data: { title?: string; password?: string } = {};
        if (editTitle !== presentation?.title) {
            data.title = editTitle;
        }
        if (editPassword) {
            data.password = editPassword;
        }
        if (Object.keys(data).length === 0) {
            setEditing(false);
            return;
        }
        updateMutation.mutate(data);
    }

    if (isLoading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }

    if (!presentation) {
        return (
            <div className="text-center py-12">
                <p className="text-muted-foreground">Presentation not found.</p>
                <Button variant="link" asChild className="mt-2">
                    <Link to="/admin">Back to list</Link>
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" asChild>
                    <Link to="/admin">
                        <ArrowLeft className="h-4 w-4" />
                    </Link>
                </Button>
                <h1 className="text-2xl font-bold flex-1">
                    {presentation.title}
                </h1>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                        window.open(`/view/${presentation.slug}`, '_blank')
                    }
                >
                    <ExternalLink className="mr-1 h-4 w-4" />
                    View as Public
                </Button>
                <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteOpen(true)}
                >
                    <Trash2 className="mr-1 h-4 w-4" />
                    Delete
                </Button>
            </div>

            <Tabs defaultValue="details">
                <TabsList>
                    <TabsTrigger value="details">Details</TabsTrigger>
                    <TabsTrigger value="sessions">
                        Sessions ({presentation.sessionCount})
                    </TabsTrigger>
                </TabsList>

                <AnimatePresence mode="wait">
                    <TabsContent value="details" key="details">
                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={transitions.page}
                        >
                            <Card>
                                <CardHeader>
                                    <CardTitle>Presentation Details</CardTitle>
                                    <CardDescription>
                                        View and edit presentation metadata
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {editing ? (
                                        <form
                                            onSubmit={handleSave}
                                            className="space-y-4"
                                        >
                                            <div className="space-y-2">
                                                <Label htmlFor="edit-title">
                                                    Title
                                                </Label>
                                                <Input
                                                    id="edit-title"
                                                    value={editTitle}
                                                    onChange={(e) =>
                                                        setEditTitle(
                                                            e.target.value
                                                        )
                                                    }
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="edit-password">
                                                    New Password
                                                </Label>
                                                <Input
                                                    id="edit-password"
                                                    type="password"
                                                    value={editPassword}
                                                    onChange={(e) =>
                                                        setEditPassword(
                                                            e.target.value
                                                        )
                                                    }
                                                    placeholder="Leave blank to keep current"
                                                />
                                            </div>
                                            <div className="flex gap-2">
                                                <Button
                                                    type="submit"
                                                    size="sm"
                                                    disabled={
                                                        updateMutation.isPending
                                                    }
                                                >
                                                    <Save className="mr-1 h-4 w-4" />
                                                    {updateMutation.isPending
                                                        ? 'Saving...'
                                                        : 'Save'}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => {
                                                        setEditing(false);
                                                        setEditTitle(
                                                            presentation.title
                                                        );
                                                        setEditPassword('');
                                                    }}
                                                >
                                                    Cancel
                                                </Button>
                                            </div>
                                        </form>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <p className="text-sm text-muted-foreground">
                                                        Title
                                                    </p>
                                                    <p className="font-medium">
                                                        {presentation.title}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-sm text-muted-foreground">
                                                        Slug
                                                    </p>
                                                    <p className="font-medium">
                                                        {presentation.slug}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-sm text-muted-foreground">
                                                        Entry File
                                                    </p>
                                                    <p className="font-medium font-mono text-sm">
                                                        {presentation.entryFile}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-sm text-muted-foreground">
                                                        Active Sessions
                                                    </p>
                                                    <p className="font-medium">
                                                        {
                                                            presentation.sessionCount
                                                        }
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-sm text-muted-foreground">
                                                        Created
                                                    </p>
                                                    <p className="font-medium">
                                                        {new Date(
                                                            presentation.createdAt
                                                        ).toLocaleString()}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-sm text-muted-foreground">
                                                        Updated
                                                    </p>
                                                    <p className="font-medium">
                                                        {new Date(
                                                            presentation.updatedAt
                                                        ).toLocaleString()}
                                                    </p>
                                                </div>
                                            </div>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setEditing(true)}
                                            >
                                                Edit
                                            </Button>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </motion.div>
                    </TabsContent>

                    <TabsContent value="sessions" key="sessions">
                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={transitions.page}
                        >
                            <Card>
                                <CardHeader>
                                    <CardTitle>Access Sessions</CardTitle>
                                    <CardDescription>
                                        Active viewer access sessions for this
                                        presentation
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {sessionsData &&
                                    sessionsData.data.length > 0 ? (
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>
                                                        Created
                                                    </TableHead>
                                                    <TableHead>
                                                        Expires
                                                    </TableHead>
                                                    <TableHead>
                                                        Status
                                                    </TableHead>
                                                    <TableHead className="w-[100px]"></TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {sessionsData.data.map(
                                                    (
                                                        session: AccessSession
                                                    ) => (
                                                        <TableRow
                                                            key={session.id}
                                                        >
                                                            <TableCell>
                                                                {new Date(
                                                                    session.createdAt
                                                                ).toLocaleString()}
                                                            </TableCell>
                                                            <TableCell>
                                                                {new Date(
                                                                    session.expiresAt
                                                                ).toLocaleString()}
                                                            </TableCell>
                                                            <TableCell>
                                                                <Badge
                                                                    variant={
                                                                        session.isExpired
                                                                            ? 'secondary'
                                                                            : 'default'
                                                                    }
                                                                >
                                                                    {session.isExpired
                                                                        ? 'Expired'
                                                                        : 'Active'}
                                                                </Badge>
                                                            </TableCell>
                                                            <TableCell>
                                                                {!session.isExpired && (
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        className="text-destructive"
                                                                        onClick={() =>
                                                                            revokeMutation.mutate(
                                                                                session.id
                                                                            )
                                                                        }
                                                                        disabled={
                                                                            revokeMutation.isPending
                                                                        }
                                                                    >
                                                                        <XCircle className="mr-1 h-4 w-4" />
                                                                        Revoke
                                                                    </Button>
                                                                )}
                                                            </TableCell>
                                                        </TableRow>
                                                    )
                                                )}
                                            </TableBody>
                                        </Table>
                                    ) : (
                                        <p className="text-sm text-muted-foreground py-4 text-center">
                                            No active sessions.
                                        </p>
                                    )}
                                </CardContent>
                            </Card>
                        </motion.div>
                    </TabsContent>
                </AnimatePresence>
            </Tabs>

            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Delete presentation?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete "{presentation.title}"
                            and all its assets. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => deleteMutation.mutate()}
                            disabled={deleteMutation.isPending}
                        >
                            {deleteMutation.isPending
                                ? 'Deleting...'
                                : 'Delete'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
