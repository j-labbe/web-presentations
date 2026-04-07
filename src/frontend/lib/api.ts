const BASE_URL = '';

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);

    if (options.body && typeof options.body === 'string') {
        headers.set('Content-Type', 'application/json');
    }

    const res = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers,
        credentials: 'include',
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message =
            (body as Record<string, string>).error ||
            `Request failed: ${res.status}`;
        throw new ApiError(message, res.status);
    }

    if (res.status === 204) {
        return undefined as T;
    }

    return res.json() as Promise<T>;
}

export class ApiError extends Error {
    constructor(
        message: string,
        public status: number
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

// --- Auth ---

export interface LoginResponse {
    username: string;
    expiresAt: string;
}

export function login(
    username: string,
    password: string
): Promise<LoginResponse> {
    return apiFetch('/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
    });
}

export function getSession(): Promise<{
    username: string;
    expiresAt: string;
}> {
    return apiFetch('/admin/auth/session');
}

export function logout(): Promise<void> {
    return apiFetch('/admin/auth/logout', { method: 'POST' });
}

// --- Admin Presentations ---

export interface PresentationSummary {
    id: string;
    title: string;
    slug: string;
    createdAt: string;
    updatedAt: string;
}

export interface PaginatedPresentations {
    data: PresentationSummary[];
    total: number;
    page: number;
    limit: number;
}

export function listPresentations(
    params: { page?: number; limit?: number; search?: string } = {}
): Promise<PaginatedPresentations> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.search) qs.set('search', params.search);
    const query = qs.toString();
    return apiFetch(`/admin/api/presentations${query ? `?${query}` : ''}`);
}

export interface PresentationDetail {
    id: string;
    title: string;
    slug: string;
    entryFile: string;
    createdAt: string;
    updatedAt: string;
    sessionCount: number;
}

export function getPresentation(id: string): Promise<PresentationDetail> {
    return apiFetch(`/admin/api/presentations/${id}`);
}

export function updatePresentation(
    id: string,
    data: { title?: string; password?: string }
): Promise<PresentationSummary> {
    return apiFetch(`/admin/api/presentations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
    });
}

export function deletePresentation(id: string): Promise<void> {
    return apiFetch(`/admin/api/presentations/${id}`, {
        method: 'DELETE',
    });
}

export interface AccessSession {
    id: string;
    createdAt: string;
    expiresAt: string;
    isExpired: boolean;
}

export function listSessions(
    presentationId: string
): Promise<{ data: AccessSession[] }> {
    return apiFetch(`/admin/api/presentations/${presentationId}/sessions`);
}

export function revokeSession(
    presentationId: string,
    sessionId: string
): Promise<void> {
    return apiFetch(
        `/admin/api/presentations/${presentationId}/sessions/${sessionId}`,
        { method: 'DELETE' }
    );
}

export function uploadPresentation(
    formData: FormData,
    onProgress?: (pct: number) => void
): Promise<PresentationSummary> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${BASE_URL}/admin/api/presentations`);
        xhr.withCredentials = true;

        if (onProgress) {
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    onProgress(Math.round((e.loaded / e.total) * 100));
                }
            });
        }

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(JSON.parse(xhr.responseText));
            } else {
                try {
                    const body = JSON.parse(xhr.responseText);
                    reject(
                        new ApiError(body.error || 'Upload failed', xhr.status)
                    );
                } catch {
                    reject(new ApiError('Upload failed', xhr.status));
                }
            }
        });

        xhr.addEventListener('error', () => {
            reject(new ApiError('Network error', 0));
        });

        xhr.send(formData);
    });
}

export interface ReplacePresentationFilesResponse {
    id: string;
    entryFile: string;
    updatedAt: string;
}

export function replacePresentationFiles(
    id: string,
    formData: FormData,
    onProgress?: (pct: number) => void
): Promise<ReplacePresentationFilesResponse> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', `${BASE_URL}/admin/api/presentations/${id}/files`);
        xhr.withCredentials = true;

        if (onProgress) {
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    onProgress(Math.round((e.loaded / e.total) * 100));
                }
            });
        }

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(JSON.parse(xhr.responseText));
            } else {
                try {
                    const body = JSON.parse(xhr.responseText);
                    reject(
                        new ApiError(body.error || 'Upload failed', xhr.status)
                    );
                } catch {
                    reject(new ApiError('Upload failed', xhr.status));
                }
            }
        });

        xhr.addEventListener('error', () => {
            reject(new ApiError('Network error', 0));
        });

        xhr.send(formData);
    });
}

// --- Public Viewer ---

export interface SlugLookup {
    id: string;
}

export function lookupSlug(slug: string): Promise<SlugLookup> {
    return apiFetch(`/presentations/by-slug/${slug}`);
}

export interface UnlockResponse {
    expiresAt: string;
}

export function unlockPresentation(
    id: string,
    password: string
): Promise<UnlockResponse> {
    return apiFetch(`/presentations/${id}/unlock`, {
        method: 'POST',
        body: JSON.stringify({ password }),
    });
}

export interface PresentationManifest {
    id: string;
    title: string;
    slug: string;
    entryFile: string;
    /** Base URL path for assets (relative or absolute). Append entryFile for the deck root. */
    assetBasePath: string;
}

export function getManifest(id: string): Promise<PresentationManifest> {
    return apiFetch(`/presentations/${id}/manifest`);
}
