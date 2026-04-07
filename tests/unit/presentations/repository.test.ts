import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryPresentationRepository } from '../../../src/presentations/repository/InMemory.js';
import { PrismaPresentationRepository } from '../../../src/presentations/repository/Prisma.js';
import type {
    CreatePresentationInput,
    PresentationRecord,
    PresentationSessionRecord,
} from '../../../src/presentations/repository/types.js';

const createPresentationInput: CreatePresentationInput = {
    title: 'Demo Deck',
    slug: 'demo-deck',
    storagePrefix: 'presentations/demo-deck',
    entryFile: 'index.html',
    passwordHash: 'hashed-password',
};

describe('InMemoryPresentationRepository', () => {
    it('stores and retrieves presentations by id and slug', async () => {
        const repository = new InMemoryPresentationRepository();

        const created = await repository.createPresentation(
            createPresentationInput
        );

        expect(created.id).toBeTypeOf('string');
        await expect(
            repository.getPresentationById(created.id)
        ).resolves.toEqual(created);
        await expect(
            repository.getPresentationBySlug(created.slug)
        ).resolves.toEqual(created);
        await expect(
            repository.getPresentationById('missing')
        ).resolves.toBeNull();
        await expect(
            repository.getPresentationBySlug('missing')
        ).resolves.toBeNull();
    });

    it('stores and retrieves access sessions by token hash', async () => {
        const repository = new InMemoryPresentationRepository();

        const session = await repository.createAccessSession({
            presentationId: 'presentation-1',
            tokenHash: 'token-hash',
            expiresAt: new Date(Date.now() + 60_000),
        });

        expect(session.id).toBeTypeOf('string');
        await expect(
            repository.getAccessSessionByTokenHash('token-hash')
        ).resolves.toEqual(session);
        await expect(
            repository.getAccessSessionByTokenHash('missing')
        ).resolves.toBeNull();
    });

    it('deletes access sessions only when presentation id matches', async () => {
        const repository = new InMemoryPresentationRepository();
        const preso = await repository.createPresentation(
            createPresentationInput
        );
        const other = await repository.createPresentation({
            ...createPresentationInput,
            slug: 'other-deck',
            storagePrefix: 'presentations/other',
        });
        const session = await repository.createAccessSession({
            presentationId: preso.id,
            tokenHash: 'hash-one',
            expiresAt: new Date(Date.now() + 60_000),
        });
        await expect(
            repository.deleteAccessSession(other.id, session.id)
        ).resolves.toBe(false);
        await expect(
            repository.getAccessSessionByTokenHash('hash-one')
        ).resolves.toEqual(session);
        await expect(
            repository.deleteAccessSession(preso.id, session.id)
        ).resolves.toBe(true);
        await expect(
            repository.getAccessSessionByTokenHash('hash-one')
        ).resolves.toBeNull();
    });
});

describe('PrismaPresentationRepository', () => {
    it('delegates presentation persistence calls to Prisma', async () => {
        const createdRecord: PresentationRecord = {
            id: 'presentation-1',
            ...createPresentationInput,
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
            updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        };
        const presentationCreate = vi.fn(
            async (_args: { data: CreatePresentationInput }) => createdRecord
        );
        const presentationFindUnique = vi.fn(
            async (_args: { where: { id?: string; slug?: string } }) =>
                createdRecord
        );
        const prisma = {
            presentation: {
                create: presentationCreate,
                findUnique: presentationFindUnique,
            },
            presentationAccessSession: {
                create: vi.fn(),
                findUnique: vi.fn(),
            },
        } as unknown as PrismaClient;
        const repository = new PrismaPresentationRepository(prisma);

        await expect(
            repository.createPresentation(createPresentationInput)
        ).resolves.toBe(createdRecord);
        await expect(
            repository.getPresentationById(createdRecord.id)
        ).resolves.toBe(createdRecord);
        await expect(
            repository.getPresentationBySlug(createdRecord.slug)
        ).resolves.toBe(createdRecord);

        expect(presentationCreate).toHaveBeenCalledWith({
            data: createPresentationInput,
        });
        expect(presentationFindUnique).toHaveBeenNthCalledWith(1, {
            where: { id: createdRecord.id },
        });
        expect(presentationFindUnique).toHaveBeenNthCalledWith(2, {
            where: { slug: createdRecord.slug },
        });
    });

    it('delegates access-session persistence calls to Prisma', async () => {
        const sessionRecord: PresentationSessionRecord = {
            id: 'session-1',
            presentationId: 'presentation-1',
            tokenHash: 'token-hash',
            expiresAt: new Date(Date.now() + 60_000),
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
        };
        const presentationAccessSessionCreate = vi.fn(
            async (_args: {
                data: {
                    presentationId: string;
                    tokenHash: string;
                    expiresAt: Date;
                };
            }) => sessionRecord
        );
        const presentationAccessSessionFindUnique = vi.fn(
            async (_args: { where: { tokenHash: string } }) => sessionRecord
        );
        const prisma = {
            presentation: {
                create: vi.fn(),
                findUnique: vi.fn(),
            },
            presentationAccessSession: {
                create: presentationAccessSessionCreate,
                findUnique: presentationAccessSessionFindUnique,
            },
        } as unknown as PrismaClient;
        const repository = new PrismaPresentationRepository(prisma);
        const input = {
            presentationId: 'presentation-1',
            tokenHash: 'token-hash',
            expiresAt: new Date(Date.now() + 60_000),
        };

        await expect(repository.createAccessSession(input)).resolves.toBe(
            sessionRecord
        );
        await expect(
            repository.getAccessSessionByTokenHash('token-hash')
        ).resolves.toBe(sessionRecord);

        expect(presentationAccessSessionCreate).toHaveBeenCalledWith({
            data: input,
        });
        expect(presentationAccessSessionFindUnique).toHaveBeenCalledWith({
            where: { tokenHash: 'token-hash' },
        });
    });
});
