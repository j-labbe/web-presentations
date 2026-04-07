import { mkdir } from 'node:fs/promises';
import { loadEnv } from './config/env.js';
import { createPrismaClient } from './plugins/prisma.js';
import { LocalPresentationStorage } from './presentations/storage/Local.js';
import { buildApp } from './app.js';

const config = loadEnv();
const prisma = createPrismaClient(config);
const storage = new LocalPresentationStorage(config.LOCAL_ASSETS_ROOT);
const app = buildApp(config, { prisma, storage });

/**
 * Starts the HTTP server and terminates the process if startup fails.
 */
const start = async () => {
    try {
        await mkdir(config.LOCAL_ASSETS_ROOT, { recursive: true });
        await prisma.$connect();
        await app.listen({ host: config.HOST, port: config.PORT });
    } catch (error) {
        app.log.error(error);
        process.exit(1);
    }
};

void start();

/**
 * Shuts down the HTTP server and disconnects the database client.
 */
const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
};

process.on('SIGINT', () => {
    void shutdown();
});
process.on('SIGTERM', () => {
    void shutdown();
});
