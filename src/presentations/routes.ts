import { stat } from 'node:fs/promises';
import argon2 from 'argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/env.js';
import { PresentationValidationError } from './errors.js';
import {
    createPresentationSchema,
    unlockPresentationSchema,
} from './schema.js';
import type { PresentationService } from './service.js';

const INVALID_UNLOCK_ERROR = 'Invalid presentation credentials.';
const INVALID_UPLOAD_AUTH_ERROR = 'Invalid upload credentials.';
const INTERNAL_UPLOAD_ERROR = 'Unable to create presentation';
const UPLOAD_AT_CAPACITY_ERROR =
    'Too many concurrent uploads. Try again later.';
const UPLOAD_RATE_LIMIT = {
    max: 5,
    timeWindow: '1 minute',
} as const;
const UNLOCK_RATE_LIMIT = {
    max: 10,
    timeWindow: '1 minute',
} as const;
const SLUG_LOOKUP_RATE_LIMIT = {
    max: 40,
    timeWindow: '1 minute',
} as const;
const MANIFEST_RATE_LIMIT = {
    max: 60,
    timeWindow: '1 minute',
} as const;
const ASSET_RATE_LIMIT = {
    max: 600,
    timeWindow: '1 minute',
} as const;
const SVG_ASSET_SECURITY_POLICY =
    "sandbox allow-scripts; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
const PRESENTATION_ACCESS_COOKIE_NAME = 'presentation_access_token';
const missingUploadPasswordHashPromise = argon2.hash(
    'missing-upload-principal-fallback'
);
type SavedMultipartFile = Awaited<
    ReturnType<FastifyRequest['saveRequestFiles']>
>[number];

function getHtmlAssetSecurityPolicy(nodeEnv: AppConfig['NODE_ENV']): string {
    const sandboxFlags = ['allow-scripts'];

    // In local development/test, many slide decks rely on localStorage and
    // other same-origin APIs. Production stays stricter until decks are served
    // from an isolated origin.
    if (nodeEnv !== 'production') {
        sandboxFlags.push('allow-same-origin');
    }

    return `sandbox ${sandboxFlags.join(
        ' '
    )}; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; object-src 'none'`;
}

/**
 * Extracts an access token from the Authorization header or a scoped cookie.
 */
function getAccessToken(request: FastifyRequest): string | null {
    const raw = request.headers.authorization;
    if (typeof raw === 'string') {
        const [scheme, token] = raw.split(' ');
        if (scheme?.toLowerCase() !== 'bearer' || !token) {
            return null;
        }

        return token;
    }

    const cookieToken = request.cookies[PRESENTATION_ACCESS_COOKIE_NAME];
    if (typeof cookieToken !== 'string' || cookieToken.length === 0) {
        return null;
    }

    return cookieToken;
}

/**
 * Extracts basic-auth upload credentials from the Authorization header.
 */
function getBasicAuthCredentials(
    request: FastifyRequest
): { username: string; password: string } | null {
    const raw = request.headers.authorization;
    if (typeof raw !== 'string') {
        return null;
    }

    const [scheme, encoded] = raw.split(' ');
    if (scheme?.toLowerCase() !== 'basic' || !encoded) {
        return null;
    }

    let decoded = '';
    try {
        decoded = Buffer.from(encoded, 'base64').toString('utf8');
    } catch {
        return null;
    }

    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex <= 0) {
        return null;
    }

    return {
        username: decoded.slice(0, separatorIndex),
        password: decoded.slice(separatorIndex + 1),
    };
}

/**
 * Authenticates an upload principal and returns its username when valid.
 */
async function authenticateUploadPrincipal(
    request: FastifyRequest,
    uploadPrincipals: AppConfig['UPLOAD_PRINCIPALS']
): Promise<string | null> {
    const credentials = getBasicAuthCredentials(request);
    if (!credentials) {
        return null;
    }

    const principal = uploadPrincipals.find(
        ({ username }) =>
            username.toLowerCase() === credentials.username.toLowerCase()
    );
    const passwordHash =
        principal?.passwordHash ?? (await missingUploadPasswordHashPromise);
    const passwordMatches = await argon2
        .verify(passwordHash, credentials.password)
        .catch(() => false);

    if (!principal || !passwordMatches) {
        return null;
    }

    return principal.username;
}

/**
 * Reads a single non-file multipart field from the saved upload metadata.
 */
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
 * Normalizes an asset path and rejects traversal or hidden-path attempts.
 */
function normalizeAssetPath(assetPath: string): string | null {
    const cleaned = assetPath.replace(/^\/+/, '');
    if (
        !cleaned ||
        cleaned.includes('..') ||
        cleaned.startsWith('.') ||
        cleaned.includes('\\')
    ) {
        return null;
    }
    return cleaned;
}

/**
 * Applies security headers to stored asset responses.
 */
function applyAssetSecurityHeaders(
    reply: FastifyReply,
    nodeEnv: AppConfig['NODE_ENV'],
    contentType?: string
): void {
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');

    const normalizedContentType = contentType?.toLowerCase();
    if (normalizedContentType?.startsWith('text/html')) {
        reply.header('X-Frame-Options', 'SAMEORIGIN');
        reply.header(
            'Content-Security-Policy',
            getHtmlAssetSecurityPolicy(nodeEnv)
        );
        return;
    }

    reply.header('X-Frame-Options', 'DENY');

    if (normalizedContentType === 'image/svg+xml') {
        reply.header('Content-Security-Policy', SVG_ASSET_SECURITY_POLICY);
    }
}

/**
 * Registers the presentation upload, unlock, manifest, and asset routes.
 */
export function registerPresentationRoutes(
    app: FastifyInstance,
    service: PresentationService,
    config: Pick<
        AppConfig,
        'NODE_ENV' | 'UPLOAD_PRINCIPALS' | 'UPLOAD_MAX_CONCURRENT'
    >
): void {
    let activeUploads = 0;

    app.post(
        '/presentations',
        {
            config: {
                rateLimit: UPLOAD_RATE_LIMIT,
            },
        },
        async (request, reply) => {
            const uploadPrincipal = await authenticateUploadPrincipal(
                request,
                config.UPLOAD_PRINCIPALS
            );
            if (!uploadPrincipal) {
                reply.header(
                    'WWW-Authenticate',
                    'Basic realm="presentation-upload"'
                );
                return reply
                    .code(401)
                    .send({ error: INVALID_UPLOAD_AUTH_ERROR });
            }

            if (activeUploads >= config.UPLOAD_MAX_CONCURRENT) {
                request.log.warn(
                    { uploadPrincipal },
                    'Rejected upload because the server is at capacity'
                );
                return reply.code(503).send({
                    error: UPLOAD_AT_CAPACITY_ERROR,
                });
            }

            activeUploads += 1;

            try {
                const files = await request.saveRequestFiles();
                const uploadedFile = files[0];
                if (!uploadedFile) {
                    return reply.code(400).send({ error: 'file is required' });
                }

                const title = uploadedFile
                    ? getMultipartFieldValue(uploadedFile.fields, 'title')
                    : '';
                const password = uploadedFile
                    ? getMultipartFieldValue(uploadedFile.fields, 'password')
                    : '';
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
                    { uploadPrincipal, presentationId: created.id },
                    'Created presentation upload'
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

                if (
                    error instanceof app.multipartErrors.FilesLimitError ||
                    error instanceof app.multipartErrors.FieldsLimitError ||
                    error instanceof app.multipartErrors.PartsLimitError ||
                    error instanceof
                        app.multipartErrors.InvalidMultipartContentTypeError ||
                    error instanceof app.multipartErrors.PrototypeViolationError
                ) {
                    return reply
                        .code(400)
                        .send({ error: 'Invalid multipart upload' });
                }

                if (error instanceof PresentationValidationError) {
                    return reply.code(400).send({
                        error: error.message,
                    });
                }

                request.log.warn(
                    { error, uploadPrincipal },
                    'Failed to create presentation'
                );
                return reply.code(500).send({
                    error: INTERNAL_UPLOAD_ERROR,
                });
            } finally {
                activeUploads -= 1;
            }
        }
    );

    app.post<{ Params: { id: string } }>(
        '/presentations/:id/unlock',
        {
            config: {
                rateLimit: UNLOCK_RATE_LIMIT,
            },
        },
        async (request, reply) => {
            const parsedBody = unlockPresentationSchema.safeParse(request.body);
            if (!parsedBody.success) {
                return reply.code(400).send({
                    error: 'Invalid payload',
                    details: parsedBody.error.issues,
                });
            }

            try {
                const unlocked = await service.unlockPresentation(
                    request.params.id,
                    parsedBody.data.password
                );

                reply.setCookie(
                    PRESENTATION_ACCESS_COOKIE_NAME,
                    unlocked.token,
                    {
                        httpOnly: true,
                        sameSite: 'lax',
                        secure: config.NODE_ENV === 'production',
                        path: `/presentations/${request.params.id}`,
                        expires: unlocked.expiresAt,
                    }
                );

                return reply.send({
                    expiresAt: unlocked.expiresAt.toISOString(),
                });
            } catch (error) {
                if (error instanceof Error) {
                    if (error.message === INVALID_UNLOCK_ERROR) {
                        return reply.code(401).send({ error: error.message });
                    }

                    request.log.warn(
                        { error },
                        'Failed to unlock presentation'
                    );
                }

                return reply.code(500).send({
                    error: 'Unable to unlock presentation',
                });
            }
        }
    );

    app.get<{ Params: { id: string } }>(
        '/presentations/:id/manifest',
        {
            config: {
                rateLimit: MANIFEST_RATE_LIMIT,
            },
        },
        async (request, reply) => {
            const token = getAccessToken(request);
            if (!token) {
                return reply.code(401).send({ error: 'Missing access token' });
            }

            const canAccess = await service.verifyAccessToken(
                request.params.id,
                token
            );
            if (!canAccess) {
                return reply
                    .code(401)
                    .send({ error: 'Invalid or expired token' });
            }

            const manifest = await service.getManifest(request.params.id);
            if (!manifest) {
                return reply
                    .code(404)
                    .send({ error: 'Presentation not found' });
            }

            return reply.send(manifest);
        }
    );

    app.get<{ Params: { id: string; '*': string } }>(
        '/presentations/:id/assets/*',
        {
            config: {
                rateLimit: ASSET_RATE_LIMIT,
            },
        },
        async (request, reply) => {
            const token = getAccessToken(request);
            if (!token) {
                return reply.code(401).send({ error: 'Missing access token' });
            }

            const canAccess = await service.verifyAccessToken(
                request.params.id,
                token
            );
            if (!canAccess) {
                return reply
                    .code(401)
                    .send({ error: 'Invalid or expired token' });
            }

            const normalizedPath = normalizeAssetPath(
                request.params['*'] ?? ''
            );
            if (!normalizedPath) {
                return reply.code(400).send({ error: 'Invalid asset path' });
            }

            const asset = await service.getAssetStream(
                request.params.id,
                normalizedPath
            );
            if (!asset) {
                return reply.code(404).send({ error: 'Asset not found' });
            }

            if (asset.contentType) {
                reply.type(asset.contentType);
            }

            applyAssetSecurityHeaders(reply, config.NODE_ENV, asset.contentType);
            return reply.send(asset.stream);
        }
    );

    /**
     * GET /presentations/by-slug/:slug - Public slug-to-ID resolver.
     */
    app.get<{ Params: { slug: string } }>(
        '/presentations/by-slug/:slug',
        {
            config: {
                rateLimit: SLUG_LOOKUP_RATE_LIMIT,
            },
        },
        async (request, reply) => {
            const result = await service.getPresentationBySlug(
                request.params.slug
            );
            if (!result) {
                return reply
                    .code(404)
                    .send({ error: 'Presentation not found' });
            }

            return reply.send(result);
        }
    );
}
