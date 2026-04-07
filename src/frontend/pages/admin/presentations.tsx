import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { transitions } from '@/lib/motion';
import {
    listPresentations,
    deletePresentation,
    type PresentationSummary,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { UploadDialog } from '@/components/upload-dialog';
import { ReplaceFilesDialog } from '@/components/replace-files-dialog';
import {
    Plus,
    Search,
    MoreHorizontal,
    Eye,
    FileUp,
    Trash2,
    ExternalLink,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';

export function PresentationsPage() {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();

    const page = Number(searchParams.get('page') || '1');
    const search = searchParams.get('search') || '';
    const [searchInput, setSearchInput] = useState(search);
    const [uploadOpen, setUploadOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] =
        useState<PresentationSummary | null>(null);
    const [replaceTarget, setReplaceTarget] =
        useState<PresentationSummary | null>(null);

    const { data, isLoading } = useQuery({
        queryKey: ['presentations', page, search],
        queryFn: () => listPresentations({ page, limit: 20, search }),
        enabled: isAuthenticated,
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deletePresentation(id),
        onSuccess: () => {
            toast.success('Presentation deleted');
            queryClient.invalidateQueries({ queryKey: ['presentations'] });
            setDeleteTarget(null);
        },
        onError: (err: Error) => {
            toast.error(err.message);
        },
    });

    const handleSearch = useCallback(() => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            if (searchInput) {
                next.set('search', searchInput);
            } else {
                next.delete('search');
            }
            next.set('page', '1');
            return next;
        });
    }, [searchInput, setSearchParams]);

    const totalPages = data ? Math.ceil(data.total / data.limit) : 0;

    function goToPage(p: number) {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set('page', String(p));
            return next;
        });
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Presentations</h1>
                <Button onClick={() => setUploadOpen(true)}>
                    <Plus className="mr-1 h-4 w-4" />
                    Upload New
                </Button>
            </div>

            <div className="flex gap-2">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by title..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        className="pl-8"
                    />
                </div>
                <Button variant="secondary" onClick={handleSearch}>
                    Search
                </Button>
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Title</TableHead>
                            <TableHead>Slug</TableHead>
                            <TableHead>Created</TableHead>
                            <TableHead className="w-[70px]"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell>
                                        <Skeleton className="h-4 w-48" />
                                    </TableCell>
                                    <TableCell>
                                        <Skeleton className="h-4 w-32" />
                                    </TableCell>
                                    <TableCell>
                                        <Skeleton className="h-4 w-24" />
                                    </TableCell>
                                    <TableCell>
                                        <Skeleton className="h-4 w-8" />
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : data && data.data.length > 0 ? (
                            data.data.map((p, index) => (
                                <motion.tr
                                    key={p.id}
                                    className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{
                                        ...transitions.row,
                                        delay: index * 0.04,
                                    }}
                                >
                                    <TableCell className="font-medium">
                                        <Link
                                            to={`/admin/presentations/${p.id}`}
                                            className="hover:underline"
                                        >
                                            {p.title}
                                        </Link>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {p.slug}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {new Date(
                                            p.createdAt
                                        ).toLocaleDateString()}
                                    </TableCell>
                                    <TableCell>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                >
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem asChild>
                                                    <Link
                                                        to={`/admin/presentations/${p.id}`}
                                                    >
                                                        <Eye className="mr-2 h-4 w-4" />
                                                        View Details
                                                    </Link>
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onClick={() =>
                                                        window.open(
                                                            `/view/${p.slug}`,
                                                            '_blank'
                                                        )
                                                    }
                                                >
                                                    <ExternalLink className="mr-2 h-4 w-4" />
                                                    View as Public
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onClick={() =>
                                                        setReplaceTarget(p)
                                                    }
                                                >
                                                    <FileUp className="mr-2 h-4 w-4" />
                                                    Replace files
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    className="text-destructive"
                                                    onClick={() =>
                                                        setDeleteTarget(p)
                                                    }
                                                >
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                    Delete
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </motion.tr>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell
                                    colSpan={4}
                                    className="text-center py-8 text-muted-foreground"
                                >
                                    {search
                                        ? 'No presentations match your search.'
                                        : 'No presentations yet. Upload one to get started.'}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => goToPage(page - 1)}
                    >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                    </Button>
                    <span className="text-sm text-muted-foreground">
                        Page {page} of {totalPages}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages}
                        onClick={() => goToPage(page + 1)}
                    >
                        Next
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            )}

            <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />

            <ReplaceFilesDialog
                open={replaceTarget !== null}
                onOpenChange={(open) => !open && setReplaceTarget(null)}
                presentation={replaceTarget}
            />

            <AlertDialog
                open={deleteTarget !== null}
                onOpenChange={(open) => !open && setDeleteTarget(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Delete presentation?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete "{deleteTarget?.title}"
                            and all its assets. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() =>
                                deleteTarget &&
                                deleteMutation.mutate(deleteTarget.id)
                            }
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
