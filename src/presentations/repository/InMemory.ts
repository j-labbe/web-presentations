import crypto from 'node:crypto';
import type {
    CreatePresentationInput,
    ListPresentationsOptions,
    PaginatedPresentations,
    PresentationRecord,
    PresentationRepository,
    PresentationSessionRecord,
    UpdatePresentationInput,
} from './types.js';

/**
 * Keeps presentation records in memory for local development and tests.
 */
export class InMemoryPresentationRepository implements PresentationRepository {
    private readonly presentations = new Map<string, PresentationRecord>();
    private readonly slugToId = new Map<string, string>();
    private readonly sessions = new Map<string, PresentationSessionRecord>();

    /**
     * Creates and stores a new presentation record.
     */
    async createPresentation(
        input: CreatePresentationInput
    ): Promise<PresentationRecord> {
        const now = new Date();
        const id = crypto.randomUUID();
        const record: PresentationRecord = {
            id,
            ...input,
            createdAt: now,
            updatedAt: now,
        };

        this.presentations.set(id, record);
        this.slugToId.set(record.slug, id);
        return record;
    }

    /**
     * Looks up a presentation by its unique identifier.
     */
    async getPresentationById(id: string): Promise<PresentationRecord | null> {
        return this.presentations.get(id) ?? null;
    }

    /**
     * Looks up a presentation by its slug.
     */
    async getPresentationBySlug(
        slug: string
    ): Promise<PresentationRecord | null> {
        const id = this.slugToId.get(slug);
        return id ? (this.presentations.get(id) ?? null) : null;
    }

    /**
     * Returns a paginated list of presentations with optional title search.
     */
    async listPresentations(
        options: ListPresentationsOptions
    ): Promise<PaginatedPresentations> {
        let records = Array.from(this.presentations.values());

        if (options.search) {
            const term = options.search.toLowerCase();
            records = records.filter((r) =>
                r.title.toLowerCase().includes(term)
            );
        }

        records.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        const total = records.length;
        const start = (options.page - 1) * options.limit;
        const data = records.slice(start, start + options.limit);

        return { data, total, page: options.page, limit: options.limit };
    }

    /**
     * Updates selected fields on a presentation record.
     */
    async updatePresentation(
        id: string,
        input: UpdatePresentationInput
    ): Promise<PresentationRecord | null> {
        const existing = this.presentations.get(id);
        if (!existing) {
            return null;
        }

        if (input.slug && input.slug !== existing.slug) {
            this.slugToId.delete(existing.slug);
            this.slugToId.set(input.slug, id);
        }

        const updated: PresentationRecord = {
            ...existing,
            ...(input.title !== undefined && { title: input.title }),
            ...(input.slug !== undefined && { slug: input.slug }),
            ...(input.passwordHash !== undefined && {
                passwordHash: input.passwordHash,
            }),
            ...(input.entryFile !== undefined && { entryFile: input.entryFile }),
            updatedAt: new Date(),
        };

        this.presentations.set(id, updated);
        return updated;
    }

    /**
     * Deletes a presentation and all its associated sessions.
     */
    async deletePresentation(id: string): Promise<boolean> {
        const existing = this.presentations.get(id);
        if (!existing) {
            return false;
        }

        this.slugToId.delete(existing.slug);
        this.presentations.delete(id);

        for (const [hash, session] of this.sessions) {
            if (session.presentationId === id) {
                this.sessions.delete(hash);
            }
        }

        return true;
    }

    /**
     * Creates and stores an access session for a presentation unlock token.
     */
    async createAccessSession(input: {
        presentationId: string;
        tokenHash: string;
        expiresAt: Date;
    }): Promise<PresentationSessionRecord> {
        const session: PresentationSessionRecord = {
            id: crypto.randomUUID(),
            ...input,
            createdAt: new Date(),
        };
        this.sessions.set(session.tokenHash, session);
        return session;
    }

    /**
     * Returns an access session by its token hash.
     */
    async getAccessSessionByTokenHash(
        tokenHash: string
    ): Promise<PresentationSessionRecord | null> {
        return this.sessions.get(tokenHash) ?? null;
    }

    /**
     * Returns all access sessions for a given presentation.
     */
    async getSessionsByPresentationId(
        presentationId: string
    ): Promise<PresentationSessionRecord[]> {
        return Array.from(this.sessions.values()).filter(
            (s) => s.presentationId === presentationId
        );
    }

    /**
     * Deletes a specific access session scoped to a presentation.
     */
    async deleteAccessSession(
        presentationId: string,
        sessionId: string
    ): Promise<boolean> {
        for (const [hash, session] of this.sessions) {
            if (
                session.id === sessionId &&
                session.presentationId === presentationId
            ) {
                this.sessions.delete(hash);
                return true;
            }
        }
        return false;
    }
}
