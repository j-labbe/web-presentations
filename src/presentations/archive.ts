import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import unzipper from 'unzipper';
import mime from 'mime-types';
import { PresentationValidationError } from './errors.js';
import type { StoredAssetInput } from './storage/types.js';

const MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024;

export interface ZipExtractionOptions {
    maxFiles: number;
    maxTotalUncompressedBytes: number;
}

/**
 * Normalizes a zip entry path into a relative forward-slash path.
 */
function normalizeZipPath(rawPath: string): string {
    return rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Determines whether an archive path could escape the expected asset root.
 */
function isUnsafePath(p: string): boolean {
    const normalized = path.posix.normalize(p);
    return (
        normalized.startsWith('../') ||
        normalized.includes('/../') ||
        path.posix.isAbsolute(normalized) ||
        normalized.startsWith('.')
    );
}

/**
 * Enforces the declared per-entry byte limit while the asset stream is read.
 */
function limitStreamBytes(
    source: Readable,
    maxBytes: number,
    filePath: string
): Readable {
    let seenBytes = 0;

    return source.pipe(
        new Transform({
            transform(chunk, _encoding, callback) {
                const chunkBuffer = Buffer.isBuffer(chunk)
                    ? chunk
                    : Buffer.from(chunk);

                seenBytes += chunkBuffer.byteLength;
                if (seenBytes > maxBytes) {
                    callback(
                        new PresentationValidationError(
                            `Archive entry too large: ${filePath}`
                        )
                    );
                    return;
                }

                callback(null, chunk);
            },
        })
    );
}

/**
 * Returns whether the uploaded filename is a zip archive.
 */
export function isZipFile(filename: string): boolean {
    return filename.toLowerCase().endsWith('.zip');
}

/**
 * Returns whether the uploaded filename is a standalone HTML document.
 */
export function isHtmlFile(filename: string): boolean {
    return filename.toLowerCase().endsWith('.html');
}

/**
 * Streams assets from a presentation zip after validating its metadata.
 *
 * @throws {Error} When the archive exceeds limits or does not contain a root
 * `index.html`.
 */
export async function extractPresentationAssetsFromZip(
    zipFilePath: string,
    options: ZipExtractionOptions,
    onAsset: (asset: StoredAssetInput) => Promise<void>
): Promise<{ entryFile: string }> {
    const directory = await unzipper.Open.file(zipFilePath).catch(() => {
        throw new PresentationValidationError('Invalid zip upload.');
    });

    if (directory.files.length > options.maxFiles) {
        throw new PresentationValidationError(
            `Zip contains too many files (max ${options.maxFiles}).`
        );
    }

    let hasIndex = false;
    let totalUncompressedBytes = 0;
    const filesToExtract: Array<{
        file: (typeof directory.files)[number];
        normalizedPath: string;
    }> = [];

    for (const file of directory.files) {
        if (file.type !== 'File') {
            continue;
        }

        const normalizedPath = normalizeZipPath(file.path);
        if (isUnsafePath(normalizedPath)) {
            throw new PresentationValidationError(
                `Unsafe archive path detected: ${file.path}`
            );
        }

        if (file.uncompressedSize > MAX_SINGLE_FILE_BYTES) {
            throw new PresentationValidationError(
                `Archive entry too large: ${file.path}`
            );
        }

        const remainingBytes =
            options.maxTotalUncompressedBytes - totalUncompressedBytes;
        if (file.uncompressedSize > remainingBytes) {
            throw new PresentationValidationError(
                `Zip exceeds total uncompressed size limit (${options.maxTotalUncompressedBytes} bytes).`
            );
        }

        totalUncompressedBytes += file.uncompressedSize;
        filesToExtract.push({ file, normalizedPath });

        if (normalizedPath === 'index.html') {
            hasIndex = true;
        }
    }

    if (!hasIndex) {
        throw new PresentationValidationError(
            'Zip must contain index.html at the archive root.'
        );
    }

    for (const { file, normalizedPath } of filesToExtract) {
        await onAsset({
            key: normalizedPath,
            body: limitStreamBytes(
                file.stream(),
                file.uncompressedSize,
                file.path
            ),
            contentType: mime.lookup(normalizedPath) || 'application/octet-stream',
            contentLength: file.uncompressedSize,
        });
    }

    return { entryFile: 'index.html' };
}
