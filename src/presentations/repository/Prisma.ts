import type { PrismaClient } from '@prisma/client';
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
 * Persists presentation records and access sessions through Prisma.
 */
export class PrismaPresentationRepository implements PresentationRepository {
    /**
     * Creates a repository backed by the provided Prisma client.
     */
    constructor(private readonly prisma: PrismaClient) {}

    /**
     * Creates a new presentation row.
     */
    async createPresentation(
        input: CreatePresentationInput
    ): Promise<PresentationRecord> {
        return this.prisma.presentation.create({ data: input });
    }

    /**
     * Looks up a presentation by its unique identifier.
     */
    async getPresentationById(id: string): Promise<PresentationRecord | null> {
        return this.prisma.presentation.findUnique({ where: { id } });
    }

    /**
     * Looks up a presentation by its slug.
     */
    async getPresentationBySlug(
        slug: string
    ): Promise<PresentationRecord | null> {
        return this.prisma.presentation.findUnique({ where: { slug } });
    }

    /**
     * Returns a paginated list of presentations with optional title search.
     */
    async listPresentations(
        options: ListPresentationsOptions
    ): Promise<PaginatedPresentations> {
        const where = options.search
            ? {
                  title: {
                      contains: options.search,
                  },
              }
            : {};

        const [data, total] = await Promise.all([
            this.prisma.presentation.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (options.page - 1) * options.limit,
                take: options.limit,
            }),
            this.prisma.presentation.count({ where }),
        ]);

        return { data, total, page: options.page, limit: options.limit };
    }

    /**
     * Updates selected fields on a presentation record.
     */
    async updatePresentation(
        id: string,
        input: UpdatePresentationInput
    ): Promise<PresentationRecord | null> {
        try {
            return await this.prisma.presentation.update({
                where: { id },
                data: input,
            });
        } catch (error: unknown) {
            if (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                (error as { code: string }).code === 'P2025'
            ) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Deletes a presentation record and its cascade-linked sessions.
     */
    async deletePresentation(id: string): Promise<boolean> {
        try {
            await this.prisma.presentation.delete({ where: { id } });
            return true;
        } catch (error: unknown) {
            if (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                (error as { code: string }).code === 'P2025'
            ) {
                return false;
            }
            throw error;
        }
    }

    /**
     * Creates an access session row for an unlock token.
     */
    async createAccessSession(input: {
        presentationId: string;
        tokenHash: string;
        expiresAt: Date;
    }): Promise<PresentationSessionRecord> {
        return this.prisma.presentationAccessSession.create({ data: input });
    }

    /**
     * Returns an access session by its token hash.
     */
    async getAccessSessionByTokenHash(
        tokenHash: string
    ): Promise<PresentationSessionRecord | null> {
        return this.prisma.presentationAccessSession.findUnique({
            where: { tokenHash },
        });
    }

    /**
     * Returns all access sessions for a given presentation.
     */
    async getSessionsByPresentationId(
        presentationId: string
    ): Promise<PresentationSessionRecord[]> {
        return this.prisma.presentationAccessSession.findMany({
            where: { presentationId },
            orderBy: { createdAt: 'desc' },
        });
    }

    /**
     * Deletes a specific access session scoped to a presentation.
     */
    async deleteAccessSession(
        presentationId: string,
        sessionId: string
    ): Promise<boolean> {
        const result = await this.prisma.presentationAccessSession.deleteMany({
            where: { id: sessionId, presentationId },
        });
        return result.count > 0;
    }
}
