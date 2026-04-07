import crypto from 'node:crypto';
import path from 'node:path';
import argon2 from 'argon2';
import { SignJWT } from 'jose';
import request from 'supertest';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config/env.js';
import { InMemoryPresentationRepository } from '../../src/presentations/repository/InMemory.js';
import type {
    CreatePresentationInput,
    ListPresentationsOptions,
    PaginatedPresentations,
    PresentationRecord,
    PresentationRepository,
    PresentationSessionRecord,
    UpdatePresentationInput,
} from '../../src/presentations/repository/types.js';
import { InMemoryPresentationStorage } from '../../src/presentations/storage/InMemory.js';

const uploadPrincipal = {
    username: 'deploy-bot',
    password: 'upload-pass-123',
} as const;
const uploadPrincipalHash = await argon2.hash(uploadPrincipal.password);

const testConfig: AppConfig = {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: 3999,
    DATABASE_URL: 'file:./test.db',
    LOCAL_ASSETS_ROOT: path.resolve(process.cwd(), 'test-integration-assets'),
    JWT_SECRET: '01234567890123456789012345678901',
    UPLOAD_PRINCIPALS: [
        {
            username: uploadPrincipal.username,
            passwordHash: uploadPrincipalHash,
        },
    ],
    UPLOAD_MAX_BYTES: 5 * 1024 * 1024,
    UPLOAD_MAX_FILES_IN_ZIP: 50,
    UPLOAD_MAX_CONCURRENT: 2,
    UNLOCK_TOKEN_TTL_SECONDS: 120,
    ADMIN_TOKEN_TTL_SECONDS: 3600,
    TRUST_PROXY: false,
};

type TestApp = Awaited<ReturnType<typeof buildApp>>;

interface UploadRequestOptions {
    principal?: { username: string; password: string } | null;
    title?: string;
    password?: string;
    file?: { buffer: Buffer; filename: string } | null;
}

const defaultUploadFile = {
    buffer: Buffer.from('<html><body>Hello</body></html>'),
    filename: 'index.html',
};

const apps: TestApp[] = [];

afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createApp(dependencies: Parameters<typeof buildApp>[1] = {}): TestApp {
    const app = buildApp(testConfig, {
        ...dependencies,
        storage: dependencies.storage ?? new InMemoryPresentationStorage(),
    });
    apps.push(app);
    return app as TestApp;
}

function createAppWithConfig(
    configOverrides: Partial<AppConfig>,
    dependencies: Parameters<typeof buildApp>[1] = {}
): TestApp {
    const app = buildApp({ ...testConfig, ...configOverrides }, {
        ...dependencies,
        storage: dependencies.storage ?? new InMemoryPresentationStorage(),
    });
    apps.push(app);
    return app as TestApp;
}

async function buildReadyApp(
    dependencies: Parameters<typeof buildApp>[1] = {}
): Promise<TestApp> {
    const app = createApp(dependencies);
    await app.ready();
    return app;
}

async function buildReadyAppWithConfig(
    configOverrides: Partial<AppConfig>,
    dependencies: Parameters<typeof buildApp>[1] = {}
): Promise<TestApp> {
    const app = createAppWithConfig(configOverrides, dependencies);
    await app.ready();
    return app;
}

async function createZip(
    files: Array<{ path: string; contents: string | Buffer }>,
    compression: 'STORE' | 'DEFLATE' = 'STORE'
): Promise<Buffer> {
    const zip = new JSZip();

    for (const file of files) {
        zip.file(file.path, file.contents);
    }

    return zip.generateAsync({
        type: 'nodebuffer',
        compression,
    });
}

function createBasicAuthHeader(principal: {
    username: string;
    password: string;
}): string {
    return `Basic ${Buffer.from(
        `${principal.username}:${principal.password}`
    ).toString('base64')}`;
}

function parsePresentationAccessTokenFromSetCookie(
    setCookie: string | string[] | undefined
): string | null {
    if (!setCookie) {
        return null;
    }
    const lines = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const line of lines) {
        const match = line.match(/^presentation_access_token=([^;]+)/);
        if (match) {
            return match[1];
        }
    }
    return null;
}

async function signAdminJwtForTests(
    username: string = uploadPrincipal.username
): Promise<string> {
    return new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(username)
        .setIssuedAt()
        .setIssuer('presentations-admin')
        .setAudience('presentations-admin')
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode(testConfig.JWT_SECRET));
}

function buildUploadRequest(app: TestApp, options: UploadRequestOptions = {}) {
    const {
        principal = uploadPrincipal,
        title = 'Demo Deck',
        password = 'super-secret-pass',
        file = defaultUploadFile,
    } = options;

    let upload = request(app.server).post('/presentations');

    if (principal !== null) {
        upload = upload.set('authorization', createBasicAuthHeader(principal));
    }
    if (title !== undefined) {
        upload = upload.field('title', title);
    }
    if (password !== undefined) {
        upload = upload.field('password', password);
    }
    if (file) {
        upload = upload.attach('file', file.buffer, file.filename);
    }

    return upload;
}

async function createUnlockedPresentation(
    app: TestApp,
    options: UploadRequestOptions = {}
): Promise<{ presentationId: string; token: string }> {
    const password = options.password ?? 'super-secret-pass';
    const upload = await buildUploadRequest(app, options);

    expect(upload.status).toBe(201);
    expect(upload.body.id).toBeTypeOf('string');

    const presentationId = upload.body.id as string;
    const unlock = await request(app.server)
        .post(`/presentations/${presentationId}/unlock`)
        .send({ password });

    expect(unlock.status).toBe(200);
    expect(unlock.body.expiresAt).toBeTypeOf('string');
    expect(unlock.body.token).toBeUndefined();

    const token = parsePresentationAccessTokenFromSetCookie(
        unlock.headers['set-cookie']
    );
    expect(token).toBeTruthy();

    return {
        presentationId,
        token: token!,
    };
}

function createUnusedRepository(): PresentationRepository {
    return {
        async createPresentation(
            _input: CreatePresentationInput
        ): Promise<PresentationRecord> {
            throw new Error('createPresentation should not be called');
        },
        async getPresentationById(
            _id: string
        ): Promise<PresentationRecord | null> {
            return null;
        },
        async getPresentationBySlug(
            _slug: string
        ): Promise<PresentationRecord | null> {
            return null;
        },
        async listPresentations(
            _options: ListPresentationsOptions
        ): Promise<PaginatedPresentations> {
            return { data: [], total: 0, page: 1, limit: 20 };
        },
        async updatePresentation(
            _id: string,
            _input: UpdatePresentationInput
        ): Promise<PresentationRecord | null> {
            return null;
        },
        async deletePresentation(_id: string): Promise<boolean> {
            return false;
        },
        async createAccessSession(_input: {
            presentationId: string;
            tokenHash: string;
            expiresAt: Date;
        }): Promise<PresentationSessionRecord> {
            throw new Error('createAccessSession should not be called');
        },
        async getAccessSessionByTokenHash(
            _tokenHash: string
        ): Promise<PresentationSessionRecord | null> {
            return null;
        },
        async getSessionsByPresentationId(
            _presentationId: string
        ): Promise<PresentationSessionRecord[]> {
            return [];
        },
        async deleteAccessSession(
            _presentationId: string,
            _sessionId: string
        ): Promise<boolean> {
            return false;
        },
    };
}

describe('presentation upload API', () => {
    it('responds to the health check', async () => {
        const app = await buildReadyApp();

        const response = await request(app.server).get('/health');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ok: true });
    });

    it('uploads html, unlocks, and serves manifest/assets', async () => {
        const app = await buildReadyApp();
        const { presentationId, token } = await createUnlockedPresentation(app);

        const manifest = await request(app.server)
            .get(`/presentations/${presentationId}/manifest`)
            .set('authorization', `Bearer ${token}`);

        expect(manifest.status).toBe(200);
        expect(manifest.body.entryFile).toBe('index.html');
        expect(manifest.body.assetBasePath).toContain(
            `/presentations/${presentationId}/assets`
        );

        const asset = await request(app.server)
            .get(`/presentations/${presentationId}/assets/index.html`)
            .set('authorization', `Bearer ${token}`);

        expect(asset.status).toBe(200);
        expect(asset.headers['content-type']).toContain('text/html');
        expect(asset.headers['content-security-policy']).toContain(
            'sandbox allow-scripts'
        );
        expect(asset.headers['content-security-policy']).toContain(
            'allow-same-origin'
        );
        expect(asset.headers['content-security-policy']).toContain(
            "frame-ancestors 'self'"
        );
        expect(asset.headers['cross-origin-resource-policy']).toBe(
            'same-origin'
        );
        expect(asset.headers['x-content-type-options']).toBe('nosniff');
        expect(asset.headers['x-frame-options']).toBe('SAMEORIGIN');
        expect(asset.text).toContain('Hello');
    });

    it('keeps same-origin disabled for production presentation html', async () => {
        const app = await buildReadyAppWithConfig({
            NODE_ENV: 'production',
        });
        const { presentationId, token } = await createUnlockedPresentation(app);

        const asset = await request(app.server)
            .get(`/presentations/${presentationId}/assets/index.html`)
            .set('authorization', `Bearer ${token}`);

        expect(asset.status).toBe(200);
        expect(asset.headers['content-type']).toContain('text/html');
        expect(asset.headers['content-security-policy']).toContain(
            'sandbox allow-scripts'
        );
        expect(asset.headers['content-security-policy']).not.toContain(
            'allow-same-origin'
        );
        expect(asset.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    it('uploads a zip and serves nested assets with their content type', async () => {
        const app = await buildReadyApp();
        const zipBuffer = await createZip([
            {
                path: 'index.html',
                contents:
                    '<html><head><link rel="stylesheet" href="styles/site.css"></head></html>',
            },
            {
                path: 'styles/site.css',
                contents: 'body { color: red; }',
            },
        ]);

        const { presentationId, token } = await createUnlockedPresentation(
            app,
            {
                title: 'Zip Deck',
                file: {
                    buffer: zipBuffer,
                    filename: 'slides.zip',
                },
            }
        );

        const asset = await request(app.server)
            .get(`/presentations/${presentationId}/assets/styles/site.css`)
            .set('authorization', `Bearer ${token}`);

        expect(asset.status).toBe(200);
        expect(asset.text).toContain('color: red');
        expect(asset.headers['content-type']).toContain('text/css');
    });

    it('applies the sandbox CSP to served SVG assets', async () => {
        const app = await buildReadyApp();
        const zipBuffer = await createZip([
            {
                path: 'index.html',
                contents:
                    '<html><body><img src="images/logo.svg"></body></html>',
            },
            {
                path: 'images/logo.svg',
                contents:
                    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            },
        ]);

        const { presentationId, token } = await createUnlockedPresentation(
            app,
            {
                title: 'SVG Deck',
                file: {
                    buffer: zipBuffer,
                    filename: 'svg-deck.zip',
                },
            }
        );

        const asset = await request(app.server)
            .get(`/presentations/${presentationId}/assets/images/logo.svg`)
            .set('authorization', `Bearer ${token}`);

        expect(asset.status).toBe(200);
        expect(asset.headers['content-type']).toContain('image/svg+xml');
        expect(asset.headers['content-security-policy']).toContain(
            'sandbox allow-scripts'
        );
        expect(asset.headers['content-security-policy']).toContain(
            "frame-ancestors 'none'"
        );
        expect(asset.headers['x-frame-options']).toBe('DENY');
    });

    it('returns a generic error for internal upload failures', async () => {
        const repository = createUnusedRepository();
        repository.createPresentation = async () => {
            throw new Error('database failed while inserting presentation');
        };

        const app = await buildReadyApp({
            repository,
            storage: new InMemoryPresentationStorage(),
        });
        const upload = await buildUploadRequest(app);

        expect(upload.status).toBe(500);
        expect(upload.body.error).toBe('Unable to create presentation');
    });

    it('rejects upload without credentials', async () => {
        const app = await buildReadyApp();

        const upload = await buildUploadRequest(app, { principal: null });

        expect(upload.status).toBe(401);
        expect(upload.body.error).toBe('Invalid upload credentials.');
    });

    it('rate limits repeated bad upload credential attempts', async () => {
        const app = await buildReadyApp();

        for (let attempt = 0; attempt < 5; attempt += 1) {
            const response = await request(app.server)
                .post('/presentations')
                .set(
                    'authorization',
                    createBasicAuthHeader({
                        username: uploadPrincipal.username,
                        password: 'wrong-upload-password',
                    })
                );

            expect(response.status).toBe(401);
            expect(response.body.error).toBe('Invalid upload credentials.');
        }

        const limited = await request(app.server)
            .post('/presentations')
            .set(
                'authorization',
                createBasicAuthHeader({
                    username: uploadPrincipal.username,
                    password: 'wrong-upload-password',
                })
            );

        expect(limited.status).toBe(429);
    });

    it.each([
        {
            name: 'an empty title',
            options: { title: '   ' },
        },
        {
            name: 'a short password',
            options: { password: 'short' },
        },
    ])('rejects upload with $name', async ({ options }) => {
        const app = await buildReadyApp();

        const upload = await buildUploadRequest(app, options);

        expect(upload.status).toBe(400);
        expect(upload.body.error).toBe('Invalid payload');
        expect(upload.body.details).toBeInstanceOf(Array);
    });

    it('rejects upload when the file is missing', async () => {
        const app = await buildReadyApp();

        const upload = await buildUploadRequest(app, { file: null });

        expect(upload.status).toBe(400);
        expect(upload.body.error).toBe('file is required');
    });

    it('rejects unsupported upload extensions', async () => {
        const app = await buildReadyApp();

        const upload = await buildUploadRequest(app, {
            file: {
                buffer: Buffer.from('plain text'),
                filename: 'notes.txt',
            },
        });

        expect(upload.status).toBe(400);
        expect(upload.body.error).toContain('.zip or .html');
    });

    it('rejects malformed zip upload', async () => {
        const app = await buildReadyApp();

        const upload = await buildUploadRequest(app, {
            title: 'Bad Zip',
            file: {
                buffer: Buffer.from('not-a-zip'),
                filename: 'slides.zip',
            },
        });

        expect(upload.status).toBe(400);
    });

    it('rejects zip uploads that expand beyond the configured byte limit', async () => {
        const app = await buildReadyAppWithConfig({
            UPLOAD_MAX_BYTES: 1024,
        });
        const zipBuffer = await createZip(
            [
                {
                    path: 'index.html',
                    contents: '<html><body>Compressed deck</body></html>',
                },
                {
                    path: 'notes.txt',
                    contents: Buffer.alloc(2048, 'a'),
                },
            ],
            'DEFLATE'
        );

        expect(zipBuffer.byteLength).toBeLessThan(1024);

        const upload = await buildUploadRequest(app, {
            title: 'Inflated Zip',
            file: {
                buffer: zipBuffer,
                filename: 'inflated.zip',
            },
        });

        expect(upload.status).toBe(400);
        expect(upload.body.error).toContain('total uncompressed size limit');
    });

    it('rejects zip when root index.html is missing', async () => {
        const app = await buildReadyApp();
        const zipBuffer = await createZip([
            {
                path: 'deck/index.html',
                contents: '<html><body>Nested only</body></html>',
            },
        ]);

        const upload = await buildUploadRequest(app, {
            title: 'Nested Zip',
            file: {
                buffer: zipBuffer,
                filename: 'nested.zip',
            },
        });

        expect(upload.status).toBe(400);
        expect(upload.body.error).toContain('index.html');
    });

    it('rejects zip uploads that exceed the file count limit', async () => {
        const app = await buildReadyApp();
        const zipFiles = Array.from({ length: 51 }, (_, index) => ({
            path: index === 0 ? 'index.html' : `assets/file-${index}.txt`,
            contents: `file-${index}`,
        }));
        const zipBuffer = await createZip(zipFiles);

        const upload = await buildUploadRequest(app, {
            title: 'Too Many Files',
            file: {
                buffer: zipBuffer,
                filename: 'too-many.zip',
            },
        });

        expect(upload.status).toBe(400);
        expect(upload.body.error).toContain('too many files');
    });

    it('rejects zip uploads with unsafe paths', async () => {
        const app = await buildReadyApp();
        const zipBuffer = await createZip([
            { path: 'index.html', contents: '<html></html>' },
            { path: '.hidden', contents: 'unsafe' },
        ]);

        const upload = await buildUploadRequest(app, {
            title: 'Unsafe Zip',
            file: {
                buffer: zipBuffer,
                filename: 'unsafe.zip',
            },
        });

        expect(upload.status).toBe(400);
        expect(upload.body.error).toContain('Unsafe archive path');
    });

    it('rejects unlock with wrong password', async () => {
        const app = await buildReadyApp();
        const upload = await buildUploadRequest(app, {
            title: 'Wrong Password Deck',
            password: 'correct-pass-123',
        });

        const unlock = await request(app.server)
            .post(`/presentations/${upload.body.id}/unlock`)
            .send({ password: 'nope' });

        expect(unlock.status).toBe(401);
        expect(unlock.body.error).toBe('Invalid presentation credentials.');
    });

    it('rate limits repeated failed unlock attempts', async () => {
        const app = await buildReadyApp();
        const upload = await buildUploadRequest(app, {
            title: 'Rate Limited Deck',
            password: 'correct-pass-123',
        });

        for (let attempt = 0; attempt < 10; attempt += 1) {
            const response = await request(app.server)
                .post(`/presentations/${upload.body.id}/unlock`)
                .send({ password: 'wrong-pass' });

            expect(response.status).toBe(401);
            expect(response.body.error).toBe(
                'Invalid presentation credentials.'
            );
        }

        const limited = await request(app.server)
            .post(`/presentations/${upload.body.id}/unlock`)
            .send({ password: 'wrong-pass' });

        expect(limited.status).toBe(429);
    });

    it('rejects unlock with an invalid request body', async () => {
        const app = await buildReadyApp();
        const { presentationId } = await createUnlockedPresentation(app);

        const unlock = await request(app.server)
            .post(`/presentations/${presentationId}/unlock`)
            .send({});

        expect(unlock.status).toBe(400);
        expect(unlock.body.error).toBe('Invalid payload');
        expect(unlock.body.details).toBeInstanceOf(Array);
    });

    it('returns the same unlock error for unknown presentations', async () => {
        const app = await buildReadyApp();

        const unlock = await request(app.server)
            .post('/presentations/00000000-0000-0000-0000-000000000000/unlock')
            .send({ password: 'super-secret-pass' });

        expect(unlock.status).toBe(401);
        expect(unlock.body.error).toBe('Invalid presentation credentials.');
    });

    it('sets an access cookie on unlock for manifest and asset requests', async () => {
        const app = await buildReadyApp();
        const upload = await buildUploadRequest(app);
        const presentationId = upload.body.id as string;
        const agent = request.agent(app.server);

        const unlock = await agent
            .post(`/presentations/${presentationId}/unlock`)
            .send({ password: 'super-secret-pass' });

        expect(unlock.status).toBe(200);
        const rawSetCookie = unlock.headers['set-cookie'];
        expect(rawSetCookie).toBeDefined();

        const cookies = Array.isArray(rawSetCookie)
            ? rawSetCookie
            : rawSetCookie
              ? [rawSetCookie]
              : [];
        expect(
            cookies.some((value) =>
                value.includes('presentation_access_token=')
            )
        ).toBe(true);
        expect(
            cookies.some((value) =>
                value.includes(`Path=/presentations/${presentationId}`)
            )
        ).toBe(true);
        expect(cookies.some((value) => value.includes('HttpOnly'))).toBe(true);
        expect(cookies.some((value) => value.includes('SameSite=Lax'))).toBe(
            true
        );

        const manifest = await agent.get(
            `/presentations/${presentationId}/manifest`
        );

        expect(manifest.status).toBe(200);
        expect(manifest.body.entryFile).toBe('index.html');

        const asset = await agent.get(
            `/presentations/${presentationId}/assets/index.html`
        );

        expect(asset.status).toBe(200);
        expect(asset.text).toContain('Hello');
    });

    it('requires an access token for manifest access', async () => {
        const app = await buildReadyApp();
        const { presentationId } = await createUnlockedPresentation(app);

        const manifest = await request(app.server).get(
            `/presentations/${presentationId}/manifest`
        );

        expect(manifest.status).toBe(401);
        expect(manifest.body.error).toBe('Missing access token');
    });

    it('rejects malformed authorization headers for manifest access', async () => {
        const app = await buildReadyApp();
        const { presentationId } = await createUnlockedPresentation(app);

        const manifest = await request(app.server)
            .get(`/presentations/${presentationId}/manifest`)
            .set('authorization', 'Basic abc123');

        expect(manifest.status).toBe(401);
        expect(manifest.body.error).toBe('Missing access token');
    });

    it('rejects manifest access with an unknown token', async () => {
        const app = await buildReadyApp();
        const { presentationId } = await createUnlockedPresentation(app);

        const manifest = await request(app.server)
            .get(`/presentations/${presentationId}/manifest`)
            .set('authorization', 'Bearer not-a-real-token');

        expect(manifest.status).toBe(401);
        expect(manifest.body.error).toBe('Invalid or expired token');
    });

    it('rejects manifest access with an expired token', async () => {
        const repository = new InMemoryPresentationRepository();
        const storage = new InMemoryPresentationStorage();
        const presentation = await repository.createPresentation({
            title: 'Expired Deck',
            slug: 'expired-deck',
            storagePrefix: 'presentations/expired-deck',
            entryFile: 'index.html',
            passwordHash: 'hash',
        });
        const token = 'expired-token';

        await repository.createAccessSession({
            presentationId: presentation.id,
            tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
            expiresAt: new Date(Date.now() - 1_000),
        });

        const app = await buildReadyApp({ repository, storage });
        const manifest = await request(app.server)
            .get(`/presentations/${presentation.id}/manifest`)
            .set('authorization', `Bearer ${token}`);

        expect(manifest.status).toBe(401);
        expect(manifest.body.error).toBe('Invalid or expired token');
    });

    it('rejects manifest access when the token belongs to another presentation', async () => {
        const app = await buildReadyApp();
        const first = await createUnlockedPresentation(app, {
            title: 'First Deck',
        });
        const second = await createUnlockedPresentation(app, {
            title: 'Second Deck',
        });

        const manifest = await request(app.server)
            .get(`/presentations/${second.presentationId}/manifest`)
            .set('authorization', `Bearer ${first.token}`);

        expect(manifest.status).toBe(401);
        expect(manifest.body.error).toBe('Invalid or expired token');
    });

    it('returns 404 for manifest access when the presentation is missing', async () => {
        const presentationId = 'presentation-missing';
        const token = 'manifest-token';
        const tokenHash = crypto
            .createHash('sha256')
            .update(token)
            .digest('hex');
        const session: PresentationSessionRecord = {
            id: 'session-1',
            presentationId,
            tokenHash,
            expiresAt: new Date(Date.now() + 60_000),
            createdAt: new Date(),
        };
        const repository = createUnusedRepository();
        repository.getAccessSessionByTokenHash = async (value) =>
            value === tokenHash ? session : null;

        const app = await buildReadyApp({
            repository,
            storage: new InMemoryPresentationStorage(),
        });
        const manifest = await request(app.server)
            .get(`/presentations/${presentationId}/manifest`)
            .set('authorization', `Bearer ${token}`);

        expect(manifest.status).toBe(404);
        expect(manifest.body.error).toBe('Presentation not found');
    });

    it('rejects invalid asset paths', async () => {
        const app = await buildReadyApp();
        const { presentationId, token } = await createUnlockedPresentation(app);

        const invalidPaths = [
            '%2E%2E%2Fsecret.txt',
            '.hidden',
            'folder%5Csecret.txt',
        ];

        for (const path of invalidPaths) {
            const asset = await request(app.server)
                .get(`/presentations/${presentationId}/assets/${path}`)
                .set('authorization', `Bearer ${token}`);

            expect(asset.status).toBe(400);
            expect(asset.body.error).toBe('Invalid asset path');
        }
    });

    it('returns 404 when an asset is missing', async () => {
        const app = await buildReadyApp();
        const { presentationId, token } = await createUnlockedPresentation(app);

        const asset = await request(app.server)
            .get(`/presentations/${presentationId}/assets/missing.txt`)
            .set('authorization', `Bearer ${token}`);

        expect(asset.status).toBe(404);
        expect(asset.body.error).toBe('Asset not found');
    });

    it('serves asset bytes from storage', async () => {
        const app = await buildReadyApp();
        const { presentationId, token } = await createUnlockedPresentation(app);

        const asset = await request(app.server)
            .get(`/presentations/${presentationId}/assets/index.html`)
            .set('authorization', `Bearer ${token}`);

        expect(asset.status).toBe(200);
        expect(asset.text).toContain('Hello');
    });

    it('replaces presentation files via admin API', async () => {
        const app = await buildReadyApp();
        const upload = await buildUploadRequest(app, { title: 'Replace Me' });
        expect(upload.status).toBe(201);
        const id = upload.body.id as string;
        const adminToken = await signAdminJwtForTests();
        const newFile = Buffer.from('<html><body>Replaced</body></html>');
        const res = await request(app.server)
            .put(`/admin/api/presentations/${id}/files`)
            .set('authorization', `Bearer ${adminToken}`)
            .attach('file', newFile, 'index.html');

        expect(res.status).toBe(200);
        expect(res.body.entryFile).toBe('index.html');

        const unlock = await request(app.server)
            .post(`/presentations/${id}/unlock`)
            .send({ password: 'super-secret-pass' });
        expect(unlock.status).toBe(200);
        const accessToken = parsePresentationAccessTokenFromSetCookie(
            unlock.headers['set-cookie']
        );
        expect(accessToken).toBeTruthy();

        const asset = await request(app.server)
            .get(`/presentations/${id}/assets/index.html`)
            .set('authorization', `Bearer ${accessToken}`);
        expect(asset.status).toBe(200);
        expect(asset.text).toContain('Replaced');
    });

    it('accepts upload basic auth with case-insensitive username', async () => {
        const app = await buildReadyApp();
        const res = await buildUploadRequest(app, {
            principal: {
                username: 'DEPLOY-BOT',
                password: uploadPrincipal.password,
            },
        });
        expect(res.status).toBe(201);
    });

    it('returns only id from slug lookup without title', async () => {
        const app = await buildReadyApp();
        const upload = await buildUploadRequest(app, { title: 'Secret Title' });
        expect(upload.status).toBe(201);
        const slug = upload.body.slug as string;
        const res = await request(app.server).get(
            `/presentations/by-slug/${encodeURIComponent(slug)}`
        );
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ id: upload.body.id });
    });

    it('rejects admin API with malformed bearer token (401, not 500)', async () => {
        const app = await buildReadyApp();
        const res = await request(app.server)
            .get('/admin/api/presentations')
            .set('authorization', 'Bearer not-a-valid.jwt.token');
        expect(res.status).toBe(401);
    });

    it('does not expose password hashes in admin presentation list', async () => {
        const app = await buildReadyApp();
        await createUnlockedPresentation(app);
        const adminToken = await signAdminJwtForTests();
        const res = await request(app.server)
            .get('/admin/api/presentations')
            .set('authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBeGreaterThan(0);
        for (const item of res.body.data) {
            expect(item).not.toHaveProperty('passwordHash');
            expect(item).not.toHaveProperty('storagePrefix');
            expect(item).not.toHaveProperty('entryFile');
        }
    });

    it('refuses to revoke a session under the wrong presentation', async () => {
        const app = await buildReadyApp();
        const first = await createUnlockedPresentation(app, { title: 'Deck A' });
        const second = await createUnlockedPresentation(app, {
            title: 'Deck B',
        });
        const adminToken = await signAdminJwtForTests();
        const sessions = await request(app.server)
            .get(`/admin/api/presentations/${first.presentationId}/sessions`)
            .set('authorization', `Bearer ${adminToken}`);
        expect(sessions.status).toBe(200);
        const sessionId = sessions.body.data[0].id as string;
        const wrong = await request(app.server)
            .delete(
                `/admin/api/presentations/${second.presentationId}/sessions/${sessionId}`
            )
            .set('authorization', `Bearer ${adminToken}`);
        expect(wrong.status).toBe(404);
        const ok = await request(app.server)
            .delete(
                `/admin/api/presentations/${first.presentationId}/sessions/${sessionId}`
            )
            .set('authorization', `Bearer ${adminToken}`);
        expect(ok.status).toBe(204);
    });
});
