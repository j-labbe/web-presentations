/**
 * Persisted presentation row returned by the repository.
 */
export interface PresentationRecord {
    /** Unique identifier (UUID). */
    id: string;
    /** Display title. */
    title: string;
    /** URL-safe slug, unique across all presentations. */
    slug: string;
    /** Object-storage prefix where assets are stored. */
    storagePrefix: string;
    /** Relative path to the root HTML document in the asset bundle. */
    entryFile: string;
    /** Argon2 hash of the presentation password. */
    passwordHash: string;
    /** Timestamp when the record was created. */
    createdAt: Date;
    /** Timestamp when the record was last modified. */
    updatedAt: Date;
}

/**
 * Persisted access session row tied to an unlock token.
 */
export interface PresentationSessionRecord {
    /** Unique identifier (UUID). */
    id: string;
    /** Presentation this session grants access to. */
    presentationId: string;
    /** SHA-256 hash of the raw bearer token. */
    tokenHash: string;
    /** Point in time after which the session is no longer valid. */
    expiresAt: Date;
    /** Timestamp when the session was created. */
    createdAt: Date;
}

/**
 * Fields required to insert a new presentation row.
 */
export interface CreatePresentationInput {
    /** Display title. */
    title: string;
    /** URL-safe slug. */
    slug: string;
    /** Object-storage prefix for the presentation's assets. */
    storagePrefix: string;
    /** Relative path to the root HTML document. */
    entryFile: string;
    /** Argon2 hash of the presentation password. */
    passwordHash: string;
}

/**
 * Options for listing presentations with pagination and optional filtering.
 */
export interface ListPresentationsOptions {
    /** Page number (1-indexed). */
    page: number;
    /** Maximum records per page. */
    limit: number;
    /** Optional case-insensitive title search. */
    search?: string;
}

/**
 * Paginated result set for presentation listings.
 */
export interface PaginatedPresentations {
    /** Presentation records for the current page. */
    data: PresentationRecord[];
    /** Total matching records across all pages. */
    total: number;
    /** Current page number. */
    page: number;
    /** Maximum records per page. */
    limit: number;
}

/**
 * Fields that can be updated on a presentation record.
 */
export interface UpdatePresentationInput {
    /** New display title. */
    title?: string;
    /** New URL-safe slug. */
    slug?: string;
    /** New argon2 password hash. */
    passwordHash?: string;
    /** New entry HTML path within the asset bundle. */
    entryFile?: string;
}

/**
 * Persistence contract for presentations and their access sessions.
 */
export interface PresentationRepository {
    /** Inserts a new presentation record. */
    createPresentation(
        input: CreatePresentationInput
    ): Promise<PresentationRecord>;
    /** Looks up a presentation by its unique identifier. */
    getPresentationById(id: string): Promise<PresentationRecord | null>;
    /** Looks up a presentation by its slug. */
    getPresentationBySlug(slug: string): Promise<PresentationRecord | null>;
    /** Returns a paginated list of presentations with optional title search. */
    listPresentations(
        options: ListPresentationsOptions
    ): Promise<PaginatedPresentations>;
    /** Updates selected fields on a presentation record. */
    updatePresentation(
        id: string,
        input: UpdatePresentationInput
    ): Promise<PresentationRecord | null>;
    /** Deletes a presentation record and its cascade-linked sessions. */
    deletePresentation(id: string): Promise<boolean>;
    /** Creates an access session for an unlock token. */
    createAccessSession(input: {
        presentationId: string;
        tokenHash: string;
        expiresAt: Date;
    }): Promise<PresentationSessionRecord>;
    /** Returns an access session by its token hash. */
    getAccessSessionByTokenHash(
        tokenHash: string
    ): Promise<PresentationSessionRecord | null>;
    /** Returns all access sessions for a given presentation. */
    getSessionsByPresentationId(
        presentationId: string
    ): Promise<PresentationSessionRecord[]>;
    /** Deletes a specific access session scoped to a presentation. */
    deleteAccessSession(
        presentationId: string,
        sessionId: string
    ): Promise<boolean>;
}
