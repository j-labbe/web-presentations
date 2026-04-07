import { stat } from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/env.js';
import { requireAdminAuth } from '../auth/admin.js';
import { PresentationValidationError } from './errors.js';
import { createPresentationSchema } from './schema.js';
import type { PresentationService } from './service.js';

/**
 * Reads a single non-file multipart field from the saved upload metadata.
 */
type SavedMultipartFile = Awaited<
    ReturnType<FastifyRequest['saveRequestFiles']>
>[number];

function getMultipartFieldValue(
    fields: SavedMultipartFile['fields'],
    fieldName: string
): string {
    const rawField = fields[fieldName];
    const field = Array.isArray(rawField) ? rawField[0] : rawField;
    if (
        !field ||
        field.type !== 'field' ||
        field.fieldnameTruncated ||
        field.valueTruncated
    ) {
        return '';
    }

    return String(field.value);
}

/**
 * Registers all admin API routes under /admin/api/*.
 */
export function registerAdminRoutes(
    app: FastifyInstance,
    service: PresentationService,
    config: Pick<AppConfig, 'JWT_SECRET' | 'UPLOAD_MAX_CONCURRENT'>
): void {
    const authHook = requireAdminAuth(config);
    let activeUploads = 0;

    /**
     * GET /admin/api/presentations - List presentations with pagination.
     */
    app.get(
        '/admin/api/presentations',
        { preHandler: authHook },
        async (request, reply) => {
            const query = request.query as {
                page?: string;
                limit?: string;
                search?: string;
            };
            const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
            const limit = Math.min(
                100,
                Math.max(1, parseInt(query.limit ?? '20', 10) || 20)
            );
            const search = query.search?.trim() || undefined;

            const result = await service.listPresentations({
                page,
                limit,
                search,
            });

            return reply.send({
                data: result.data.map((p) => ({
                    id: p.id,
                    title: p.title,
                    slug: p.slug,
                    createdAt: p.createdAt,
                    updatedAt: p.updatedAt,
                })),
                total: result.total,
                page: result.page,
                limit: result.limit,
            });
        }
    );

    /**
     * GET /admin/api/presentations/:id - Get single presentation.
     */
    app.get<{ Params: { id: string } }>(
        '/admin/api/presentations/:id',
        { preHandler: authHook },
        async (request, reply) => {
            const detail = await service.getPresentationDetail(
                request.params.id
            );
            if (!detail) {
                return reply
                    .code(404)
                    .send({ error: 'Presentation not found' });
            }

            return reply.send({
                id: detail.id,
                title: detail.title,
                slug: detail.slug,
                entryFile: detail.entryFile,
                createdAt: detail.createdAt,
                updatedAt: detail.updatedAt,
                sessionCount: detail.sessionCount,
            });
        }
    );

    /**
     * PATCH /admin/api/presentations/:id - Update a presentation.
     */
    app.patch<{ Params: { id: string } }>(
        '/admin/api/presentations/:id',
        { preHandler: authHook },
        async (request, reply) => {
            const body = request.body as
                | { title?: string; password?: string }
                | undefined;

            if (!body || (!body.title?.trim() && !body.password)) {
                return reply
                    .code(400)
                    .send({
                        error: 'At least one field (title or password) is required',
                    });
            }

            const updates: { title?: string; password?: string } = {};
            if (body.title?.trim()) {
                const trimmed = body.title.trim();
                if (trimmed.length < 1 || trimmed.length > 120) {
                    return reply.code(400).send({
                        error: 'Title must be between 1 and 120 characters',
                    });
                }
                updates.title = trimmed;
            }
            if (body.password) {
                if (body.password.length < 8 || body.password.length > 128) {
                    return reply.code(400).send({
                        error: 'Password must be between 8 and 128 characters',
                    });
                }
                updates.password = body.password;
            }

            const updated = await service.updatePresentation(
                request.params.id,
                updates
            );
            if (!updated) {
                return reply
                    .code(404)
                    .send({ error: 'Presentation not found' });
            }

            return reply.send({
                id: updated.id,
                title: updated.title,
                slug: updated.slug,
                updatedAt: updated.updatedAt,
            });
        }
    );

    /**
     * DELETE /admin/api/presentations/:id - Delete a presentation.
     */
    app.delete<{ Params: { id: string } }>(
        '/admin/api/presentations/:id',
        { preHandler: authHook },
        async (request, reply) => {
            const deleted = await service.deletePresentation(request.params.id);
            if (!deleted) {
                return reply
                    .code(404)
                    .send({ error: 'Presentation not found' });
            }

            return reply.code(204).send();
        }
    );

    /**
     * GET /admin/api/presentations/:id/sessions - List access sessions.
     */
    app.get<{ Params: { id: string } }>(
        '/admin/api/presentations/:id/sessions',
        { preHandler: authHook },
        async (request, reply) => {
            const sessions = await service.getSessionsByPresentationId(
                request.params.id
            );
            const now = Date.now();

            return reply.send({
                data: sessions.map((s) => ({
                    id: s.id,
                    createdAt: s.createdAt,
                    expiresAt: s.expiresAt,
                    isExpired: s.expiresAt.getTime() <= now,
                })),
            });
        }
    );

    /**
     * DELETE /admin/api/presentations/:id/sessions/:sessionId - Revoke a session.
     */
    app.delete<{ Params: { id: string; sessionId: string } }>(
        '/admin/api/presentations/:id/sessions/:sessionId',
        { preHandler: authHook },
        async (request, reply) => {
            const deleted = await service.deleteAccessSession(
                request.params.id,
                request.params.sessionId
            );
            if (!deleted) {
                return reply.code(404).send({ error: 'Session not found' });
            }

            return reply.code(204).send();
        }
    );

    /**
     * POST /admin/api/presentations - Upload a new presentation (JWT auth).
     */
    app.post(
        '/admin/api/presentations',
        { preHandler: authHook },
        async (request, reply) => {
            if (activeUploads >= config.UPLOAD_MAX_CONCURRENT) {
                request.log.warn('Rejected admin upload at capacity');
                return reply.code(503).send({
                    error: 'Too many concurrent uploads. Try again later.',
                });
            }

            activeUploads += 1;

            try {
                const files = await request.saveRequestFiles();
                const uploadedFile = files[0];
                if (!uploadedFile) {
                    return reply.code(400).send({ error: 'file is required' });
                }

                const title = getMultipartFieldValue(
                    uploadedFile.fields,
                    'title'
                );
                const password = getMultipartFieldValue(
                    uploadedFile.fields,
                    'password'
                );
                const parsed = createPresentationSchema.safeParse({
                    title,
                    password,
                });
                if (!parsed.success) {
                    return reply.code(400).send({
                        error: 'Invalid payload',
                        details: parsed.error.issues,
                    });
                }

                const fileStats = await stat(uploadedFile.filepath);
                const created = await service.createPresentation({
                    title: parsed.data.title,
                    password: parsed.data.password,
                    filename: uploadedFile.filename,
                    filePath: uploadedFile.filepath,
                    byteLength: fileStats.size,
                });

                request.log.info(
                    { presentationId: created.id },
                    'Created presentation via admin upload'
                );

                return reply.code(201).send({
                    id: created.id,
                    title: created.title,
                    slug: created.slug,
                    createdAt: created.createdAt,
                });
            } catch (error) {
                if (
                    error instanceof
                    app.multipartErrors.RequestFileTooLargeError
                ) {
                    return reply.code(413).send({ error: 'Upload too large.' });
                }

                if (error instanceof PresentationValidationError) {
                    return reply.code(400).send({ error: error.message });
                }

                request.log.warn(
                    { error },
                    'Failed to create presentation via admin'
                );
                return reply
                    .code(500)
                    .send({ error: 'Unable to create presentation' });
            } finally {
                activeUploads -= 1;
            }
        }
    );

    /**
     * PUT /admin/api/presentations/:id/files - Replace presentation assets (JWT auth).
     */
    app.put<{ Params: { id: string } }>(
        '/admin/api/presentations/:id/files',
        { preHandler: authHook },
        async (request, reply) => {
            if (activeUploads >= config.UPLOAD_MAX_CONCURRENT) {
                request.log.warn('Rejected admin replace-files at capacity');
                return reply.code(503).send({
                    error: 'Too many concurrent uploads. Try again later.',
                });
            }

            activeUploads += 1;

            try {
                const files = await request.saveRequestFiles();
                const uploadedFile = files[0];
                if (!uploadedFile) {
                    return reply.code(400).send({ error: 'file is required' });
                }

                const fileStats = await stat(uploadedFile.filepath);
                const updated = await service.replacePresentationAssets(
                    request.params.id,
                    {
                        filename: uploadedFile.filename,
                        filePath: uploadedFile.filepath,
                        byteLength: fileStats.size,
                    }
                );

                if (!updated) {
                    return reply
                        .code(404)
                        .send({ error: 'Presentation not found' });
                }

                request.log.info(
                    { presentationId: updated.id },
                    'Replaced presentation files via admin'
                );

                return reply.send({
                    id: updated.id,
                    entryFile: updated.entryFile,
                    updatedAt: updated.updatedAt,
                });
            } catch (error) {
                if (
                    error instanceof
                    app.multipartErrors.RequestFileTooLargeError
                ) {
                    return reply.code(413).send({ error: 'Upload too large.' });
                }

                if (error instanceof PresentationValidationError) {
                    return reply.code(400).send({ error: error.message });
                }

                request.log.warn(
                    { error },
                    'Failed to replace presentation files via admin'
                );
                return reply
                    .code(500)
                    .send({ error: 'Unable to replace presentation files' });
            } finally {
                activeUploads -= 1;
            }
        }
    );
}
