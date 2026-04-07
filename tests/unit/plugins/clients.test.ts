import { describe, expect, it, vi } from 'vitest';

const { PrismaClientMock } = vi.hoisted(() => ({
    PrismaClientMock: vi.fn().mockImplementation(function (
        this: { options?: unknown },
        options
    ) {
        this.options = options;
    }),
}));

vi.mock('@prisma/client', () => ({
    PrismaClient: PrismaClientMock,
}));

import { createPrismaClient } from '../../../src/plugins/prisma.js';

describe('client factories', () => {
    it('creates a Prisma client with the configured datasource URL', () => {
        const client = createPrismaClient({
            DATABASE_URL: 'file:./test.db',
        }) as { options?: unknown };

        expect(PrismaClientMock).toHaveBeenCalledWith({
            datasourceUrl: 'file:./test.db',
        });
        expect(client.options).toEqual({
            datasourceUrl: 'file:./test.db',
        });
    });
});
