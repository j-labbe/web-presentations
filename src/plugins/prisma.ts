import { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config/env.js';

/**
 * Creates a Prisma client bound to the configured datasource URL.
 */
export function createPrismaClient(
    config: Pick<AppConfig, 'DATABASE_URL'>
): PrismaClient {
    return new PrismaClient({
        datasourceUrl: config.DATABASE_URL,
    });
}
