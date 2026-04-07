import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from './config/env.js';
import type { PresentationRepository } from './presentations/repository/types.js';
import type { PresentationStorage } from './presentations/storage/types.js';
import { InMemoryPresentationRepository } from './presentations/repository/InMemory.js';
import { PrismaPresentationRepository } from './presentations/repository/Prisma.js';
import { LocalPresentationStorage } from './presentations/storage/Local.js';
import { PresentationService } from './presentations/service.js';
import { registerPresentationRoutes } from './presentations/routes.js';
import { registerAdminAuth } from './auth/admin.js';
import { registerAdminRoutes } from './presentations/admin-routes.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export interface AppDependencies {
    repository?: PresentationRepository;
    storage?: PresentationStorage;
    prisma?: PrismaClient;
}

/**
 * Builds the Fastify application and wires the configured presentation
 * dependencies.
 */
export function buildApp(
    config: AppConfig,
    dependencies: AppDependencies = {}
) {
    const app = Fastify({
        logger: true,
        trustProxy: config.TRUST_PROXY,
    });

    app.register(helmet, {
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: false,
    });

    const repository =
        dependencies.repository ??
        (dependencies.prisma
            ? new PrismaPresentationRepository(dependencies.prisma)
            : new InMemoryPresentationRepository());

    const storage =
        dependencies.storage ??
        new LocalPresentationStorage(config.LOCAL_ASSETS_ROOT);

    const service = new PresentationService(repository, storage, config);

    // CORS: Allow Vite dev server origin in development
    if (config.NODE_ENV === 'development') {
        app.register(cors, {
            origin: ['http://localhost:5173'],
            credentials: true,
        });
    }

    // Cookie plugin for session cookie auth on asset routes
    app.register(cookie);

    app.get('/health', async () => ({ ok: true }));

    // Admin authentication (login endpoint with rate limiting)
    app.register(async function adminAuthPlugin(adminAuthApp) {
        await adminAuthApp.register(rateLimit, { global: false });
        registerAdminAuth(adminAuthApp, config);
    });

    // Admin API routes (JWT-protected management endpoints)
    app.register(async function adminApiPlugin(adminApp) {
        await adminApp.register(multipart, {
            limits: {
                files: 1,
                fields: 2,
                parts: 3,
                fieldSize: 1024,
                fileSize: config.UPLOAD_MAX_BYTES,
            },
        });

        registerAdminRoutes(adminApp, service, config);
    });

    // Public presentation API routes (upload, unlock, manifest, assets)
    app.register(async function presentationApi(presentationApp) {
        await presentationApp.register(multipart, {
            limits: {
                files: 1,
                fields: 2,
                parts: 3,
                fieldSize: 1024,
                fileSize: config.UPLOAD_MAX_BYTES,
            },
        });
        await presentationApp.register(rateLimit, {
            global: false,
        });

        registerPresentationRoutes(presentationApp, service, config);
    });

    // Serve frontend static files and SPA fallback.
    // __dirname is `src` when running via tsx, or `dist/src` when running compiled output;
    // Vite always emits to `<project>/dist/frontend`.
    const parentDir = resolve(__dirname, '..');
    const projectRoot =
        basename(parentDir) === 'dist'
            ? resolve(__dirname, '..', '..')
            : parentDir;
    const frontendDir = resolve(projectRoot, 'dist', 'frontend');

    if (existsSync(frontendDir)) {
        app.register(async function staticPlugin(staticApp) {
            const fastifyStatic = (await import('@fastify/static')).default;
            await staticApp.register(fastifyStatic, {
                root: frontendDir,
                prefix: '/',
                wildcard: false,
            });
        });

        // SPA fallback: serve index.html for /admin/* and /view/* routes
        app.setNotFoundHandler(async (request, reply) => {
            const { url } = request;
            if (url.startsWith('/admin') || url.startsWith('/view')) {
                const { createReadStream } = await import('node:fs');
                const indexPath = join(frontendDir, 'index.html');
                reply.type('text/html');
                return reply.send(createReadStream(indexPath));
            }

            return reply.code(404).send({ error: 'Not found' });
        });
    }

    return app;
}
