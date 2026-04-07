import type { Readable } from 'node:stream';

/**
 * A single file payload to be written to object storage.
 */
export interface StoredAssetInput {
    /** Relative path within the storage prefix (e.g. `index.html`). */
    key: string;
    /** File contents, provided either as a buffer or a readable stream. */
    body: Buffer | Readable;
    /** MIME type for the asset, used as the `Content-Type` when served. */
    contentType?: string;
    /** Exact byte size when known. */
    contentLength?: number;
}

/**
 * A readable stream for a previously stored asset.
 */
export interface StoredAssetStream {
    /** Node readable stream of the asset's contents. */
    stream: Readable;
    /** MIME type of the asset. */
    contentType?: string;
}

/**
 * Persistence contract for presentation asset storage (filesystem, in-memory).
 */
export interface PresentationStorage {
    /** Writes a single asset beneath the given storage prefix. */
    putAsset(prefix: string, asset: StoredAssetInput): Promise<void>;
    /** Returns a readable stream for an asset, or `null` if it doesn't exist. */
    getAssetStream(
        prefix: string,
        relativePath: string
    ): Promise<StoredAssetStream | null>;
    /** Deletes all assets stored under the given prefix. */
    deleteAssets(prefix: string): Promise<void>;
}
