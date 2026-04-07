import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import mime from 'mime-types';
import type {
    PresentationStorage,
    StoredAssetInput,
    StoredAssetStream,
} from './types.js';

function assertSafeRelativeKey(key: string): void {
    if (
        !key ||
        key.includes('..') ||
        path.isAbsolute(key) ||
        key.includes('\\')
    ) {
        throw new Error('Unsafe asset key');
    }
}

/**
 * Stores presentation assets on the local filesystem under LOCAL_ASSETS_ROOT.
 */
export class LocalPresentationStorage implements PresentationStorage {
    /**
     * @param root Absolute directory; assets are stored at root/prefix/key
     */
    constructor(private readonly root: string) {}

    /**
     * Absolute path for a prefix + key, validated to stay under root.
     */
    private async assetPath(prefix: string, relativePath: string): Promise<string> {
        const base = path.resolve(this.root, ...prefix.split('/'), relativePath);
        const rootResolved = path.resolve(this.root);
        if (!base.startsWith(rootResolved + path.sep) && base !== rootResolved) {
            throw new Error('Path escapes root');
        }
        return base;
    }

    private baseDirForPrefix(prefix: string): string {
        return path.resolve(this.root, ...prefix.split('/'));
    }

    /**
     * Writes an asset beneath the provided storage prefix.
     */
    async putAsset(prefix: string, asset: StoredAssetInput): Promise<void> {
        assertSafeRelativeKey(asset.key);
        const fullPath = await this.assetPath(prefix, asset.key);
        await mkdir(path.dirname(fullPath), { recursive: true });

        if (Buffer.isBuffer(asset.body)) {
            const { writeFile } = await import('node:fs/promises');
            await writeFile(fullPath, asset.body);
            return;
        }

        await pipeline(asset.body, createWriteStream(fullPath));
    }

    /**
     * Returns a readable stream for a stored asset when it exists.
     */
    async getAssetStream(
        prefix: string,
        relativePath: string
    ): Promise<StoredAssetStream | null> {
        assertSafeRelativeKey(relativePath);
        const fullPath = await this.assetPath(prefix, relativePath);
        try {
            const st = await stat(fullPath);
            if (!st.isFile()) {
                return null;
            }
        } catch {
            return null;
        }

        const contentType = mime.lookup(relativePath) || undefined;
        return {
            stream: createReadStream(fullPath),
            contentType,
        };
    }

    /**
     * Deletes all files under the given prefix directory.
     */
    async deleteAssets(prefix: string): Promise<void> {
        const dir = this.baseDirForPrefix(prefix);
        const rootResolved = path.resolve(this.root);
        if (!dir.startsWith(rootResolved + path.sep) && dir !== rootResolved) {
            throw new Error('Path escapes root');
        }
        await rm(dir, { recursive: true, force: true });
    }
}
