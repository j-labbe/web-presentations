import { useState, useCallback, useRef, useEffect, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { transitions } from '@/lib/motion';
import { replacePresentationFiles, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { FileUp } from 'lucide-react';
import type { PresentationSummary } from '@/lib/api';

interface ReplaceFilesDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    presentation: PresentationSummary | null;
}

export function ReplaceFilesDialog({
    open,
    onOpenChange,
    presentation,
}: ReplaceFilesDialogProps) {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState('');
    const [dragOver, setDragOver] = useState(false);

    useEffect(() => {
        if (open && presentation) {
            setFile(null);
            setError('');
            setProgress(0);
            setDragOver(false);
        }
    }, [open, presentation?.id]);

    function reset() {
        setFile(null);
        setUploading(false);
        setProgress(0);
        setError('');
        setDragOver(false);
    }

    function handleClose(nextOpen: boolean) {
        if (!uploading) {
            if (!nextOpen) reset();
            onOpenChange(nextOpen);
        }
    }

    function handleFileSelect(files: FileList | null) {
        if (!files || files.length === 0) return;
        const f = files[0];
        const valid =
            f.name.endsWith('.html') ||
            f.name.endsWith('.htm') ||
            f.name.endsWith('.zip');
        if (!valid) {
            setError('Please select an .html or .zip file');
            return;
        }
        setError('');
        setFile(f);
    }

    function handleDrop(e: DragEvent) {
        e.preventDefault();
        setDragOver(false);
        handleFileSelect(e.dataTransfer.files);
    }

    const handleDragOver = useCallback((e: DragEvent) => {
        e.preventDefault();
        setDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: DragEvent) => {
        e.preventDefault();
        setDragOver(false);
    }, []);

    async function handleSubmit() {
        if (!file || !presentation || !isAuthenticated) return;

        setError('');
        setUploading(true);
        setProgress(0);

        const formData = new FormData();
        formData.append('file', file);

        try {
            await replacePresentationFiles(
                presentation.id,
                formData,
                setProgress
            );
            toast.success('Presentation files replaced');
            queryClient.invalidateQueries({ queryKey: ['presentations'] });
            queryClient.invalidateQueries({
                queryKey: ['presentation', presentation.id],
            });
            reset();
            onOpenChange(false);
        } catch (err) {
            if (err instanceof ApiError) {
                setError(err.message);
            } else {
                setError('Replace failed');
            }
        } finally {
            setUploading(false);
        }
    }

    const title = presentation?.title ?? '';

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Replace files</DialogTitle>
                    <DialogDescription>
                        Upload a new .html or .zip for &quot;{title}&quot;. Existing
                        files are removed first. Title, slug, and viewer password
                        stay the same.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".html,.htm,.zip"
                        className="hidden"
                        onChange={(e) => handleFileSelect(e.target.files)}
                    />

                    <motion.div
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                fileInputRef.current?.click();
                            }
                        }}
                        onClick={() => fileInputRef.current?.click()}
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
                            dragOver
                                ? 'border-primary bg-primary/5'
                                : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                        }`}
                        transition={transitions.row}
                    >
                        <FileUp className="mb-2 h-8 w-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground text-center">
                            {file
                                ? file.name
                                : 'Drop a file here or click to browse'}
                        </p>
                    </motion.div>

                    {uploading && (
                        <div className="space-y-1">
                            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                    className="h-full bg-primary transition-all"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <p className="text-xs text-muted-foreground text-center">
                                {progress}%
                            </p>
                        </div>
                    )}

                    {error && (
                        <p className="text-sm text-destructive">{error}</p>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleClose(false)}
                        disabled={uploading}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!file || uploading}
                    >
                        {uploading ? 'Replacing...' : 'Replace files'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
