import crypto from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import argon2 from 'argon2';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { PresentationService } from '../../../src/presentations/service.js';
import type {
    CreatePresentationInput,
    ListPresentationsOptions,
    PaginatedPresentations,
    PresentationRecord,
    PresentationRepository,
    PresentationSessionRecord,
    UpdatePresentationInput,
} from '../../../src/presentations/repository/types.js';
import type {
    PresentationStorage,
    StoredAssetInput,
    StoredAssetStream,
} from '../../../src/presentations/storage/types.js';

interface ServiceConfig {
    UPLOAD_MAX_BYTES: number;
    UPLOAD_MAX_FILES_IN_ZIP: number;
    UNLOCK_TOKEN_TTL_SECONDS: number;
}

const defaultConfig: ServiceConfig = {
    UPLOAD_MAX_BYTES: 1_024,
    UPLOAD_MAX_FILES_IN_ZIP: 10,
    UNLOCK_TOKEN_TTL_SECONDS: 60,
};

function buildPresentationRecord(
    overrides: Partial<PresentationRecord> = {}
): PresentationRecord {
    const now = new Date('2024-01-01T00:00:00.000Z');

    return {
        id: 'presentation-1',
        title: 'Demo Deck',
        slug: 'demo-deck',
        storagePrefix: 'presentations/presentation-1',
        entryFile: 'index.html',
        passwordHash: 'hashed-password',
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

function buildSessionRecord(
    overrides: Partial<PresentationSessionRecord> = {}
): PresentationSessionRecord {
    const tokenHash =
        overrides.tokenHash ??
        crypto.createHash('sha256').update('session-token').digest('hex');

    return {
        id: 'session-1',
        presentationId: 'presentation-1',
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        ...overrides,
    };
}

function createZip(
    files: Array<{ path: string; contents: string | Buffer }>
): Promise<Buffer> {
    const zip = new JSZip();

    for (const file of files) {
        zip.file(file.path, file.contents);
    }

    return zip.generateAsync({
        type: 'nodebuffer',
        compression: 'STORE',
    });
}

async function withTempUploadFile<T>(
    buffer: Buffer,
    filename: string,
    run: (upload: {
        filename: string;
        filePath: string;
        byteLength: number;
    }) => Promise<T>
): Promise<T> {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'presentation-service-'));
    const filePath = path.join(tempDir, filename);
    await writeFile(filePath, buffer);

    try {
        return await run({
            filename,
            filePath,
            byteLength: buffer.byteLength,
        });
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
}

async function assetBodyToBuffer(body: Buffer | Readable): Promise<Buffer> {
    if (Buffer.isBuffer(body)) {
        return body;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
}

function createServiceHarness(configOverrides: Partial<ServiceConfig> = {}) {
    const createPresentation = vi.fn(
        async (input: CreatePresentationInput): Promise<PresentationRecord> =>
            buildPresentationRecord(input)
    );
    const getPresentationById = vi.fn(
        async (_id: string): Promise<PresentationRecord | null> => null
    );
    const getPresentationBySlug = vi.fn(
        async (_slug: string): Promise<PresentationRecord | null> => null
    );
    const createAccessSession = vi.fn(
        async (input: {
            presentationId: string;
            tokenHash: string;
            expiresAt: Date;
        }): Promise<PresentationSessionRecord> => buildSessionRecord(input)
    );
    const getAccessSessionByTokenHash = vi.fn(
        async (_tokenHash: string): Promise<PresentationSessionRecord | null> =>
            null
    );
    const listPresentations = vi.fn(
        async (
            _options: ListPresentationsOptions
        ): Promise<PaginatedPresentations> => ({
            data: [],
            total: 0,
            page: 1,
            limit: 20,
        })
    );
    const updatePresentation = vi.fn(
        async (
            _id: string,
            _input: UpdatePresentationInput
        ): Promise<PresentationRecord | null> => null
    );
    const deletePresentation = vi.fn(
        async (_id: string): Promise<boolean> => false
    );
    const getSessionsByPresentationId = vi.fn(
        async (
            _presentationId: string
        ): Promise<PresentationSessionRecord[]> => []
    );
    const deleteAccessSession = vi.fn(
        async (_presentationId: string, _sessionId: string): Promise<boolean> =>
            false
    );
    const putAsset = vi.fn(
        async (_prefix: string, _asset: StoredAssetInput): Promise<void> =>
            undefined
    );
    const getAssetStream = vi.fn(
        async (
            _prefix: string,
            _relativePath: string
        ): Promise<StoredAssetStream | null> => null
    );
    const deleteAssets = vi.fn(
        async (_prefix: string): Promise<void> => undefined
    );

    const repository: PresentationRepository = {
        createPresentation,
        getPresentationById,
        getPresentationBySlug,
        listPresentations,
        updatePresentation,
        deletePresentation,
        createAccessSession,
        getAccessSessionByTokenHash,
        getSessionsByPresentationId,
        deleteAccessSession,
    };
    const storage: PresentationStorage = {
        putAsset,
        getAssetStream,
        deleteAssets,
    };
    const service = new PresentationService(repository, storage, {
        ...defaultConfig,
        ...configOverrides,
    });

    return {
        service,
        repository,
        storage,
        mocks: {
            createPresentation,
            getPresentationById,
            getPresentationBySlug,
            listPresentations,
            updatePresentation: updatePresentation,
            deletePresentation: deletePresentation,
            createAccessSession,
            getAccessSessionByTokenHash,
            getSessionsByPresentationId,
            deleteAccessSession: deleteAccessSession,
            putAsset,
            getAssetStream,
            deleteAssets,
        },
    };
}

describe('PresentationService', () => {
    it('rejects uploads that exceed the configured byte limit', async () => {
        const { service, mocks } = createServiceHarness({
            UPLOAD_MAX_BYTES: 5,
        });

        await withTempUploadFile(
            Buffer.alloc(6),
            'index.html',
            async (upload) => {
                await expect(
                    service.createPresentation({
                        title: 'Large Deck',
                        password: 'super-secret-pass',
                        ...upload,
                    })
                ).rejects.toThrow('Upload too large.');
            }
        );

        expect(mocks.putAsset).not.toHaveBeenCalled();
        expect(mocks.createPresentation).not.toHaveBeenCalled();
    });

    it('creates an html presentation, stores index.html, and avoids slug collisions', async () => {
        const { service, mocks } = createServiceHarness();
        const htmlBytes = Buffer.from('<html><body>Hello</body></html>');

        mocks.getPresentationBySlug
            .mockResolvedValueOnce(buildPresentationRecord())
            .mockResolvedValueOnce(null);

        const created = await withTempUploadFile(
            htmlBytes,
            'demo.html',
            async (upload) => {
                return service.createPresentation({
                    title: 'Demo Deck',
                    password: 'super-secret-pass',
                    ...upload,
                });
            }
        );

        expect(created.slug).toBe('demo-deck-1');
        expect(mocks.putAsset).toHaveBeenCalledTimes(1);

        const [storagePrefix, asset] = mocks.putAsset.mock.calls[0] as [
            string,
            StoredAssetInput,
        ];

        expect(storagePrefix).toMatch(/^presentations\//);
        expect(asset.key).toBe('index.html');
        expect(asset.contentType).toBe('text/html');
        expect(asset.contentLength).toBe(htmlBytes.byteLength);
        await expect(assetBodyToBuffer(asset.body)).resolves.toEqual(htmlBytes);
        expect(mocks.createPresentation).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Demo Deck',
                slug: 'demo-deck-1',
                entryFile: 'index.html',
            })
        );
    });

    it('extracts zip uploads into stored assets', async () => {
        const { service, mocks } = createServiceHarness();
        const zipBytes = await createZip([
            { path: 'index.html', contents: '<html></html>' },
            { path: 'assets/app.js', contents: 'console.log("ready");' },
        ]);

        const created = await withTempUploadFile(
            zipBytes,
            'slides.zip',
            async (upload) => {
                return service.createPresentation({
                    title: 'Zip Deck',
                    password: 'super-secret-pass',
                    ...upload,
                });
            }
        );

        expect(created.entryFile).toBe('index.html');
        expect(mocks.putAsset).toHaveBeenCalledTimes(2);

        const calls = mocks.putAsset.mock.calls as Array<
            [string, StoredAssetInput]
        >;

        expect(calls.map(([, asset]) => asset.key).sort()).toEqual([
            'assets/app.js',
            'index.html',
        ]);
    });

    it('rejects unsupported upload file types', async () => {
        const { service, mocks } = createServiceHarness();

        await withTempUploadFile(
            Buffer.from('hello'),
            'notes.txt',
            async (upload) => {
                await expect(
                    service.createPresentation({
                        title: 'Text Deck',
                        password: 'super-secret-pass',
                        ...upload,
                    })
                ).rejects.toThrow('Only .zip or .html uploads are supported.');
            }
        );

        expect(mocks.putAsset).not.toHaveBeenCalled();
    });

    it('issues unlock tokens and stores the hashed session token', async () => {
        const { service, mocks } = createServiceHarness({
            UNLOCK_TOKEN_TTL_SECONDS: 120,
        });
        const passwordHash = await argon2.hash('super-secret-pass');
        const presentation = buildPresentationRecord({ passwordHash });

        mocks.getPresentationById.mockResolvedValue(presentation);

        const unlocked = await service.unlockPresentation(
            presentation.id,
            'super-secret-pass'
        );

        expect(unlocked.token).toMatch(/^[0-9a-f]{64}$/);
        expect(mocks.createAccessSession).toHaveBeenCalledTimes(1);

        const [sessionInput] = mocks.createAccessSession.mock.calls[0] as [
            {
                presentationId: string;
                tokenHash: string;
                expiresAt: Date;
            },
        ];

        expect(sessionInput.presentationId).toBe(presentation.id);
        expect(sessionInput.tokenHash).toBe(
            crypto.createHash('sha256').update(unlocked.token).digest('hex')
        );
        expect(sessionInput.expiresAt.getTime()).toBe(
            unlocked.expiresAt.getTime()
        );
    });

    it('rejects unlock attempts for missing presentations', async () => {
        const { service } = createServiceHarness();

        await expect(
            service.unlockPresentation(
                'missing-presentation',
                'secret-password'
            )
        ).rejects.toThrow('Invalid presentation credentials.');
    });

    it('rejects unlock attempts with an invalid password', async () => {
        const { service, mocks } = createServiceHarness();
        const passwordHash = await argon2.hash('correct-password');

        mocks.getPresentationById.mockResolvedValue(
            buildPresentationRecord({ passwordHash })
        );

        await expect(
            service.unlockPresentation('presentation-1', 'wrong-password')
        ).rejects.toThrow('Invalid presentation credentials.');
    });

    it('verifies a valid access token for the matching presentation', async () => {
        const { service, mocks } = createServiceHarness();
        const rawToken = 'session-token';
        const tokenHash = crypto
            .createHash('sha256')
            .update(rawToken)
            .digest('hex');

        mocks.getAccessSessionByTokenHash.mockResolvedValue(
            buildSessionRecord({ tokenHash })
        );

        await expect(
            service.verifyAccessToken('presentation-1', rawToken)
        ).resolves.toBe(true);
        expect(mocks.getAccessSessionByTokenHash).toHaveBeenCalledWith(
            tokenHash
        );
    });

    it.each([
        {
            name: 'no session exists',
            session: null,
        },
        {
            name: 'the token belongs to another presentation',
            session: buildSessionRecord({ presentationId: 'presentation-2' }),
        },
        {
            name: 'the session has expired',
            session: buildSessionRecord({
                expiresAt: new Date(Date.now() - 1_000),
            }),
        },
    ])('rejects access when $name', async ({ session }) => {
        const { service, mocks } = createServiceHarness();

        mocks.getAccessSessionByTokenHash.mockResolvedValue(session);

        await expect(
            service.verifyAccessToken('presentation-1', 'session-token')
        ).resolves.toBe(false);
    });

    it('builds manifests for stored presentations', async () => {
        const { service, mocks } = createServiceHarness();
        const presentation = buildPresentationRecord({
            id: 'presentation-42',
            title: 'Manifest Deck',
            slug: 'manifest-deck',
            entryFile: 'slides/index.html',
        });

        mocks.getPresentationById.mockResolvedValue(presentation);

        await expect(service.getManifest(presentation.id)).resolves.toEqual({
            id: presentation.id,
            title: 'Manifest Deck',
            slug: 'manifest-deck',
            entryFile: 'slides/index.html',
            assetBasePath: `/presentations/${presentation.id}/assets`,
        });
    });

    it('returns null manifests and assets when the presentation is missing', async () => {
        const { service, mocks } = createServiceHarness();

        await expect(service.getManifest('missing')).resolves.toBeNull();
        await expect(
            service.getAssetStream('missing', 'index.html')
        ).resolves.toBeNull();
        expect(mocks.getAssetStream).not.toHaveBeenCalled();
    });

    it('loads asset streams from storage for existing presentations', async () => {
        const { service, mocks } = createServiceHarness();
        const presentation = buildPresentationRecord({
            storagePrefix: 'presentations/presentation-99',
        });
        const streamResult: StoredAssetStream = {
            stream: Readable.from('asset body'),
            contentType: 'text/plain',
        };

        mocks.getPresentationById.mockResolvedValue(presentation);
        mocks.getAssetStream.mockResolvedValue(streamResult);

        await expect(
            service.getAssetStream(presentation.id, 'notes.txt')
        ).resolves.toBe(streamResult);
        expect(mocks.getAssetStream).toHaveBeenCalledWith(
            presentation.storagePrefix,
            'notes.txt'
        );
    });

    it('replaces presentation assets and updates entryFile', async () => {
        const { service, mocks } = createServiceHarness();
        const presentation = buildPresentationRecord({
            id: 'pres-1',
            storagePrefix: 'presentations/pres-1',
            entryFile: 'index.html',
        });
        mocks.getPresentationById.mockResolvedValue(presentation);
        mocks.updatePresentation.mockImplementation(async (_id, input) =>
            buildPresentationRecord({
                ...presentation,
                ...input,
                updatedAt: new Date(Date.now() + 1000),
            })
        );

        await withTempUploadFile(
            Buffer.from('<html><body>New</body></html>'),
            'index.html',
            async (upload) => {
                const result = await service.replacePresentationAssets(
                    'pres-1',
                    upload
                );
                expect(result?.entryFile).toBe('index.html');
            }
        );

        expect(mocks.deleteAssets).toHaveBeenCalledWith(
            'presentations/pres-1'
        );
        expect(mocks.putAsset).toHaveBeenCalled();
        expect(mocks.updatePresentation).toHaveBeenCalled();
    });

    it('returns null when replacing assets for a missing presentation', async () => {
        const { service, mocks } = createServiceHarness();
        mocks.getPresentationById.mockResolvedValue(null);

        await withTempUploadFile(
            Buffer.from('<html></html>'),
            'index.html',
            async (upload) => {
                await expect(
                    service.replacePresentationAssets('missing', upload)
                ).resolves.toBeNull();
            }
        );
        expect(mocks.deleteAssets).not.toHaveBeenCalled();
    });
});
