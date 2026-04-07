import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { Readable } from 'node:stream';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
    extractPresentationAssetsFromZip,
    isHtmlFile,
    isZipFile,
} from '../../../src/presentations/archive.js';
import type { StoredAssetInput } from '../../../src/presentations/storage/types.js';

function createZip(
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

async function withTempZipFile<T>(
    zipBuffer: Buffer,
    run: (zipFilePath: string) => Promise<T>
): Promise<T> {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'presentation-archive-'));
    const zipFilePath = path.join(tempDir, 'upload.zip');
    await writeFile(zipFilePath, zipBuffer);

    try {
        return await run(zipFilePath);
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

async function collectZipExtraction(
    zipBuffer: Buffer,
    options: Parameters<typeof extractPresentationAssetsFromZip>[1]
): Promise<{
    assets: Array<Omit<StoredAssetInput, 'body'> & { body: Buffer }>;
    entryFile: string;
}> {
    return withTempZipFile(zipBuffer, async (zipFilePath) => {
        const assets: Array<Omit<StoredAssetInput, 'body'> & { body: Buffer }> =
            [];
        const extracted = await extractPresentationAssetsFromZip(
            zipFilePath,
            options,
            async (asset) => {
                assets.push({
                    ...asset,
                    body: await assetBodyToBuffer(asset.body),
                });
            }
        );

        return {
            assets,
            entryFile: extracted.entryFile,
        };
    });
}

describe('presentation archive helpers', () => {
    it('detects supported upload extensions case-insensitively', () => {
        expect(isZipFile('slides.ZIP')).toBe(true);
        expect(isZipFile('slides.html')).toBe(false);
        expect(isHtmlFile('deck.HTML')).toBe(true);
        expect(isHtmlFile('deck.zip')).toBe(false);
    });

    it('extracts assets from a zip with a root index.html', async () => {
        const zipBuffer = await createZip([
            { path: 'index.html', contents: '<html></html>' },
            { path: 'styles/site.css', contents: 'body { color: red; }' },
        ]);

        const extracted = await collectZipExtraction(zipBuffer, {
            maxFiles: 10,
            maxTotalUncompressedBytes: 1024 * 1024,
        });

        expect(extracted.entryFile).toBe('index.html');
        expect(extracted.assets).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    key: 'index.html',
                    contentType: 'text/html',
                }),
                expect.objectContaining({
                    key: 'styles/site.css',
                    contentType: 'text/css',
                }),
            ])
        );
    });

    it('rejects zips that exceed the allowed file count', async () => {
        const zipBuffer = await createZip([
            { path: 'index.html', contents: '<html></html>' },
            { path: 'assets/a.txt', contents: 'a' },
            { path: 'assets/b.txt', contents: 'b' },
        ]);

        await withTempZipFile(zipBuffer, async (zipFilePath) => {
            await expect(
                extractPresentationAssetsFromZip(zipFilePath, {
                    maxFiles: 2,
                    maxTotalUncompressedBytes: 1024 * 1024,
                }, async () => undefined)
            ).rejects.toThrow('Zip contains too many files');
        });
    });

    it('rejects zips with unsafe entry paths', async () => {
        const zipBuffer = await createZip([
            { path: 'index.html', contents: '<html></html>' },
            { path: '.hidden', contents: 'secret' },
        ]);

        await withTempZipFile(zipBuffer, async (zipFilePath) => {
            await expect(
                extractPresentationAssetsFromZip(
                    zipFilePath,
                    {
                        maxFiles: 10,
                        maxTotalUncompressedBytes: 1024 * 1024,
                    },
                    async () => undefined
                )
            ).rejects.toThrow('Unsafe archive path detected');
        });
    });

    it('rejects zips with oversized files', async () => {
        const zipBuffer = await createZip([
            { path: 'index.html', contents: '<html></html>' },
            {
                path: 'big.bin',
                contents: Buffer.alloc(10 * 1024 * 1024 + 1, 1),
            },
        ]);

        await withTempZipFile(zipBuffer, async (zipFilePath) => {
            await expect(
                extractPresentationAssetsFromZip(
                    zipFilePath,
                    {
                        maxFiles: 10,
                        maxTotalUncompressedBytes: 20 * 1024 * 1024,
                    },
                    async () => undefined
                )
            ).rejects.toThrow('Archive entry too large');
        });
    });

    it('rejects zips that exceed the total uncompressed size limit', async () => {
        const zipBuffer = await createZip(
            [
                { path: 'index.html', contents: '<html></html>' },
                {
                    path: 'notes.txt',
                    contents: Buffer.alloc(2048, 'a'),
                },
            ],
            'DEFLATE'
        );

        expect(zipBuffer.byteLength).toBeLessThan(1024);

        await withTempZipFile(zipBuffer, async (zipFilePath) => {
            await expect(
                extractPresentationAssetsFromZip(
                    zipFilePath,
                    {
                        maxFiles: 10,
                        maxTotalUncompressedBytes: 1024,
                    },
                    async () => undefined
                )
            ).rejects.toThrow('total uncompressed size limit');
        });
    });

    it('rejects zips without a root index.html', async () => {
        const zipBuffer = await createZip([
            { path: 'deck/index.html', contents: '<html></html>' },
        ]);

        await withTempZipFile(zipBuffer, async (zipFilePath) => {
            await expect(
                extractPresentationAssetsFromZip(
                    zipFilePath,
                    {
                        maxFiles: 10,
                        maxTotalUncompressedBytes: 1024 * 1024,
                    },
                    async () => undefined
                )
            ).rejects.toThrow('Zip must contain index.html at the archive root.');
        });
    });
});
