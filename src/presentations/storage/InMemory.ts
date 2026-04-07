import type { Readable } from 'node:stream';
import type {
    PresentationStorage,
    StoredAssetInput,
    StoredAssetStream,
} from './types.js';

async function toBuffer(body: Buffer | Readable): Promise<Buffer> {
    if (Buffer.isBuffer(body)) {
        return body;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
}

/**
 * Stores presentation assets in memory for local use and tests.
 */
export class InMemoryPresentationStorage implements PresentationStorage {
    private readonly objects = new Map<
        string,
        { body: Buffer; contentType?: string }
    >();

    /**
     * Persists an asset beneath the provided storage prefix.
     */
    async putAsset(prefix: string, asset: StoredAssetInput): Promise<void> {
        this.objects.set(`${prefix}/${asset.key}`, {
            body: await toBuffer(asset.body),
            contentType: asset.contentType,
        });
    }

    /**
     * Returns a readable stream for a stored asset when it exists.
     */
    async getAssetStream(
        prefix: string,
        relativePath: string
    ): Promise<StoredAssetStream | null> {
        const stored = this.objects.get(`${prefix}/${relativePath}`);
        if (!stored) {
            return null;
        }

        const { Readable } = await import('node:stream');
        return {
            stream: Readable.from(stored.body) as Readable,
            contentType: stored.contentType,
        };
    }

    /**
     * Deletes all assets stored under the given prefix.
     */
    async deleteAssets(prefix: string): Promise<void> {
        const keysToDelete: string[] = [];
        for (const key of this.objects.keys()) {
            if (key.startsWith(`${prefix}/`)) {
                keysToDelete.push(key);
            }
        }
        for (const key of keysToDelete) {
            this.objects.delete(key);
        }
    }
}
