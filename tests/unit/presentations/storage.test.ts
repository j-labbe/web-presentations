import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { InMemoryPresentationStorage } from '../../../src/presentations/storage/InMemory.js';
import { LocalPresentationStorage } from '../../../src/presentations/storage/Local.js';
import type { StoredAssetInput } from '../../../src/presentations/storage/types.js';

async function streamToString(stream: Readable): Promise<string> {
    let output = '';

    for await (const chunk of stream) {
        output += chunk.toString();
    }

    return output;
}

describe('InMemoryPresentationStorage', () => {
    it('stores streamed assets and returns their streams', async () => {
        const storage = new InMemoryPresentationStorage();
        const asset: StoredAssetInput = {
            key: 'index.html',
            body: Readable.from('<html><body>Hello</body></html>'),
            contentType: 'text/html',
            contentLength: 31,
        };

        await storage.putAsset('presentations/demo-deck', asset);

        const stored = await storage.getAssetStream(
            'presentations/demo-deck',
            'index.html'
        );

        expect(stored?.contentType).toBe('text/html');
        expect(await streamToString(stored!.stream)).toContain('Hello');
    });

    it('returns null when an asset is missing', async () => {
        const storage = new InMemoryPresentationStorage();

        await expect(
            storage.getAssetStream('presentations/demo-deck', 'missing.txt')
        ).resolves.toBeNull();
    });
});

describe('LocalPresentationStorage', () => {
    it('stores assets on disk and streams them back', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'pres-'));
        const storage = new LocalPresentationStorage(root);

        try {
            await storage.putAsset('presentations/demo-deck', {
                key: 'index.html',
                body: Buffer.from('<html><body>Local</body></html>'),
                contentType: 'text/html',
                contentLength: 30,
            });

            const diskPath = path.join(
                root,
                'presentations',
                'demo-deck',
                'index.html'
            );
            expect(await readFile(diskPath, 'utf8')).toContain('Local');

            const stored = await storage.getAssetStream(
                'presentations/demo-deck',
                'index.html'
            );
            expect(stored?.contentType).toBe('text/html');
            expect(await streamToString(stored!.stream)).toContain('Local');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('stores streamed bodies', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'pres-'));
        const storage = new LocalPresentationStorage(root);

        try {
            await storage.putAsset('presentations/demo-deck', {
                key: 'notes.txt',
                body: Readable.from('streamed'),
                contentType: 'text/plain',
            });

            const stored = await storage.getAssetStream(
                'presentations/demo-deck',
                'notes.txt'
            );
            expect(await streamToString(stored!.stream)).toBe('streamed');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('deleteAssets removes the prefix directory', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'pres-'));
        const storage = new LocalPresentationStorage(root);

        try {
            await storage.putAsset('presentations/demo-deck', {
                key: 'a.txt',
                body: Buffer.from('x'),
            });
            await storage.deleteAssets('presentations/demo-deck');

            await expect(
                storage.getAssetStream('presentations/demo-deck', 'a.txt')
            ).resolves.toBeNull();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('returns null when an asset is missing', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'pres-'));
        const storage = new LocalPresentationStorage(root);

        try {
            await expect(
                storage.getAssetStream('presentations/demo-deck', 'missing.txt')
            ).resolves.toBeNull();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
