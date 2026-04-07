import { useState, useCallback, useRef, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { transitions } from '@/lib/motion';
import { uploadPresentation, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { Upload, FileUp, CircleHelp } from 'lucide-react';

interface UploadDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function UploadDialog({ open, onOpenChange }: UploadDialogProps) {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [title, setTitle] = useState('');
    const [password, setPassword] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState('');
    const [dragOver, setDragOver] = useState(false);

    function reset() {
        setTitle('');
        setPassword('');
        setFile(null);
        setUploading(false);
        setProgress(0);
        setError('');
        setDragOver(false);
    }

    function handleClose(open: boolean) {
        if (!uploading) {
            if (!open) reset();
            onOpenChange(open);
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
        // Auto-fill title from filename if empty
        if (!title) {
            const name = f.name.replace(/\.(html|htm|zip)$/, '');
            setTitle(name);
        }
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
        if (!file || !title || !password || !isAuthenticated) return;

        setError('');
        setUploading(true);
        setProgress(0);

        const formData = new FormData();
        formData.append('title', title);
        formData.append('password', password);
        formData.append('file', file);

        try {
            await uploadPresentation(formData, setProgress);
            toast.success('Presentation uploaded successfully');
            queryClient.invalidateQueries({ queryKey: ['presentations'] });
            reset();
            onOpenChange(false);
        } catch (err) {
            if (err instanceof ApiError) {
                setError(err.message);
            } else {
                setError('Upload failed');
            }
        } finally {
            setUploading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Upload Presentation</DialogTitle>
                    <DialogDescription>
                        Upload an HTML file or ZIP archive containing your
                        presentation.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="upload-title">Title</Label>
                        <Input
                            id="upload-title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="My Presentation"
                            disabled={uploading}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="upload-password">Viewer Password</Label>
                        <Input
                            id="upload-password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Password for viewers"
                            disabled={uploading}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>File</Label>
                        <div
                            className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors cursor-pointer ${
                                dragOver
                                    ? 'border-primary bg-primary/5'
                                    : 'border-muted-foreground/25 hover:border-primary/50'
                            }`}
                            onDrop={handleDrop}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".html,.htm,.zip"
                                className="hidden"
                                onChange={(e) =>
                                    handleFileSelect(e.target.files)
                                }
                                disabled={uploading}
                            />
                            {file ? (
                                <>
                                    <FileUp className="mb-2 h-8 w-8 text-primary" />
                                    <p className="text-sm font-medium">
                                        {file.name}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {(file.size / 1024 / 1024).toFixed(1)}{' '}
                                        MB
                                    </p>
                                </>
                            ) : (
                                <>
                                    <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
                                    <p className="text-sm text-muted-foreground">
                                        Drop file here or click to browse
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        .html or .zip
                                    </p>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="rounded-md border bg-muted/40 px-3 py-2 my-2 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                            <span>
                                Uploaded presentations can run scripts in
                                viewers' browsers. Only upload files from
                                trusted internal sources.
                            </span>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            className="inline-flex items-center cursor-pointer text-muted-foreground hover:text-foreground"
                                            aria-label="More information about upload safety"
                                        >
                                            <CircleHelp className="h-3.5 w-3.5" />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                        Presentation files may include JavaScript.
                                        That code can use browser features on the
                                        presentation site and call external APIs.
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                    </div>

                    {uploading && (
                        <div className="space-y-1">
                            <div className="flex justify-between text-sm">
                                <span>Uploading...</span>
                                <span>{progress}%</span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                                <motion.div
                                    className="h-full rounded-full bg-primary"
                                    initial={{ width: 0 }}
                                    animate={{
                                        width: `${progress}%`,
                                    }}
                                    transition={transitions.progress}
                                />
                            </div>
                        </div>
                    )}

                    {error && (
                        <p className="text-sm text-destructive">{error}</p>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => handleClose(false)}
                        disabled={uploading}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={!file || !title || !password || uploading}
                    >
                        {uploading ? 'Uploading...' : 'Upload'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
