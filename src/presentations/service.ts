import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import argon2 from 'argon2';
import mime from 'mime-types';
import type { AppConfig } from '../config/env.js';
import {
    extractPresentationAssetsFromZip,
    isHtmlFile,
    isZipFile,
} from './archive.js';
import { PresentationValidationError } from './errors.js';
import type {
    PresentationRecord,
    PresentationRepository,
    PresentationSessionRecord,
    ListPresentationsOptions,
    PaginatedPresentations,
} from './repository/types.js';
import type { PresentationStorage } from './storage/types.js';
import type {
    PresentationFilePayload,
    PresentationManifest,
    UploadPayload,
} from './types.js';

const INVALID_UNLOCK_ERROR = 'Invalid presentation credentials.';
const missingPresentationPasswordHashPromise = argon2.hash(
    'missing-presentation-password-fallback'
);

/**
 * Coordinates presentation uploads, storage, and access control.
 */
export class PresentationService {
    /**
     * Creates a service with the configured persistence and upload settings.
     */
    constructor(
        private readonly repository: PresentationRepository,
        private readonly storage: PresentationStorage,
        private readonly config: Pick<
            AppConfig,
            | 'UPLOAD_MAX_BYTES'
            | 'UPLOAD_MAX_FILES_IN_ZIP'
            | 'UNLOCK_TOKEN_TTL_SECONDS'
        >
    ) {}

    /**
     * Validates an upload, stores its assets, and creates the presentation
     * record.
     *
     * @throws {Error} When the upload exceeds size limits or is not supported.
     */
    async createPresentation(
        payload: UploadPayload
    ): Promise<PresentationRecord> {
        if (payload.byteLength > this.config.UPLOAD_MAX_BYTES) {
            throw new PresentationValidationError('Upload too large.');
        }

        const slug = await this.makeUniqueSlug(payload.title);
        const id = crypto.randomUUID();
        const storagePrefix = `presentations/${id}`;
        const passwordHash = await argon2.hash(payload.password);
        const entryFile = await this.storeUpload(storagePrefix, payload);

        return this.repository.createPresentation({
            title: payload.title,
            slug,
            storagePrefix,
            entryFile,
            passwordHash,
        });
    }

    /**
     * Replaces stored assets for an existing presentation: deletes old files,
     * stores the new upload under the same prefix, and updates `entryFile`.
     */
    async replacePresentationAssets(
        presentationId: string,
        payload: PresentationFilePayload
    ): Promise<PresentationRecord | null> {
        if (payload.byteLength > this.config.UPLOAD_MAX_BYTES) {
            throw new PresentationValidationError('Upload too large.');
        }

        const presentation =
            await this.repository.getPresentationById(presentationId);
        if (!presentation) {
            return null;
        }

        await this.storage.deleteAssets(presentation.storagePrefix);
        const entryFile = await this.storeUpload(
            presentation.storagePrefix,
            payload
        );

        return this.repository.updatePresentation(presentationId, {
            entryFile,
        });
    }

    /**
     * Verifies a presentation password and issues a temporary access token.
     *
     * @throws {Error} When the presentation does not exist or the password is
     * invalid.
     */
    async unlockPresentation(
        presentationId: string,
        password: string
    ): Promise<{ token: string; expiresAt: Date }> {
        const presentation =
            await this.repository.getPresentationById(presentationId);
        if (!presentation) {
            await argon2.verify(
                await missingPresentationPasswordHashPromise,
                password
            );
            throw new Error(INVALID_UNLOCK_ERROR);
        }

        const isMatch = await argon2.verify(
            presentation.passwordHash,
            password
        );
        if (!isMatch) {
            throw new Error(INVALID_UNLOCK_ERROR);
        }

        const expiresAt = new Date(
            Date.now() + this.config.UNLOCK_TOKEN_TTL_SECONDS * 1000
        );
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto
            .createHash('sha256')
            .update(token)
            .digest('hex');

        await this.repository.createAccessSession({
            presentationId,
            tokenHash,
            expiresAt,
        });

        return { token, expiresAt };
    }

    /**
     * Checks whether a raw access token belongs to the presentation and is
     * still valid.
     */
    async verifyAccessToken(
        presentationId: string,
        rawToken: string
    ): Promise<boolean> {
        const tokenHash = crypto
            .createHash('sha256')
            .update(rawToken)
            .digest('hex');
        const session =
            await this.repository.getAccessSessionByTokenHash(tokenHash);
        if (!session) {
            return false;
        }

        if (session.presentationId !== presentationId) {
            return false;
        }

        return session.expiresAt.getTime() > Date.now();
    }

    /**
     * Builds the client-facing manifest for a presentation.
     */
    async getManifest(
        presentationId: string
    ): Promise<PresentationManifest | null> {
        const presentation =
            await this.repository.getPresentationById(presentationId);
        if (!presentation) {
            return null;
        }

        return {
            id: presentation.id,
            title: presentation.title,
            slug: presentation.slug,
            entryFile: presentation.entryFile,
            assetBasePath: `/presentations/${presentation.id}/assets`,
        };
    }

    /**
     * Returns the stored asset stream for a presentation asset path.
     */
    async getAssetStream(presentationId: string, assetPath: string) {
        const presentation =
            await this.repository.getPresentationById(presentationId);
        if (!presentation) {
            return null;
        }

        return this.storage.getAssetStream(
            presentation.storagePrefix,
            assetPath
        );
    }

    /**
     * Returns a paginated list of presentations with optional title search.
     */
    async listPresentations(
        options: ListPresentationsOptions
    ): Promise<PaginatedPresentations> {
        return this.repository.listPresentations(options);
    }

    /**
     * Returns a presentation by ID with its active session count.
     */
    async getPresentationDetail(
        presentationId: string
    ): Promise<(PresentationRecord & { sessionCount: number }) | null> {
        const presentation =
            await this.repository.getPresentationById(presentationId);
        if (!presentation) {
            return null;
        }

        const sessions =
            await this.repository.getSessionsByPresentationId(presentationId);
        const now = Date.now();
        const sessionCount = sessions.filter(
            (s) => s.expiresAt.getTime() > now
        ).length;

        return { ...presentation, sessionCount };
    }

    /**
     * Updates a presentation's title and/or password.
     *
     * When the title changes, the slug is regenerated to maintain consistency.
     * When the password changes, it is re-hashed with argon2.
     */
    async updatePresentation(
        presentationId: string,
        updates: { title?: string; password?: string }
    ): Promise<PresentationRecord | null> {
        const existing =
            await this.repository.getPresentationById(presentationId);
        if (!existing) {
            return null;
        }

        const input: { title?: string; slug?: string; passwordHash?: string } =
            {};

        if (updates.title && updates.title !== existing.title) {
            input.title = updates.title;
            input.slug = await this.makeUniqueSlug(updates.title);
        }

        if (updates.password) {
            input.passwordHash = await argon2.hash(updates.password);
        }

        if (Object.keys(input).length === 0) {
            return existing;
        }

        return this.repository.updatePresentation(presentationId, input);
    }

    /**
     * Deletes a presentation and all of its stored assets.
     */
    async deletePresentation(presentationId: string): Promise<boolean> {
        const presentation =
            await this.repository.getPresentationById(presentationId);
        if (!presentation) {
            return false;
        }

        await this.storage.deleteAssets(presentation.storagePrefix);
        return this.repository.deletePresentation(presentationId);
    }

    /**
     * Returns all access sessions for a given presentation.
     */
    async getSessionsByPresentationId(
        presentationId: string
    ): Promise<PresentationSessionRecord[]> {
        return this.repository.getSessionsByPresentationId(presentationId);
    }

    /**
     * Deletes a specific access session scoped to a presentation.
     */
    async deleteAccessSession(
        presentationId: string,
        sessionId: string
    ): Promise<boolean> {
        return this.repository.deleteAccessSession(presentationId, sessionId);
    }

    /**
     * Resolves a presentation slug to its public identifier.
     */
    async getPresentationBySlug(slug: string): Promise<{ id: string } | null> {
        const presentation = await this.repository.getPresentationBySlug(slug);
        if (!presentation) {
            return null;
        }

        return { id: presentation.id };
    }

    /**
     * Generates a unique slug by appending a numeric suffix when needed.
     */
    private async makeUniqueSlug(title: string): Promise<string> {
        const base = this.toSlug(title) || 'presentation';
        let candidate = base;
        let suffix = 0;

        while (await this.repository.getPresentationBySlug(candidate)) {
            suffix += 1;
            candidate = `${base}-${suffix}`;
        }

        return candidate;
    }

    /**
     * Converts a title into a URL-safe slug.
     */
    private toSlug(value: string): string {
        return value
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+/, '')
            .replace(/-+$/, '');
    }

    /**
     * Stores a supported upload and returns its entry file path.
     *
     * @throws {Error} When the uploaded file type is unsupported.
     */
    private async storeUpload(
        storagePrefix: string,
        payload: PresentationFilePayload
    ): Promise<string> {
        if (isZipFile(payload.filename)) {
            const { entryFile } = await extractPresentationAssetsFromZip(
                payload.filePath,
                {
                    maxFiles: this.config.UPLOAD_MAX_FILES_IN_ZIP,
                    maxTotalUncompressedBytes: this.config.UPLOAD_MAX_BYTES,
                },
                async (asset) => {
                    await this.storage.putAsset(storagePrefix, asset);
                }
            );

            return entryFile;
        }

        if (isHtmlFile(payload.filename)) {
            await this.storage.putAsset(storagePrefix, {
                key: 'index.html',
                body: createReadStream(payload.filePath),
                contentType: mime.lookup('index.html') || 'text/html',
                contentLength: payload.byteLength,
            });

            return 'index.html';
        }

        throw new PresentationValidationError(
            'Only .zip or .html uploads are supported.'
        );
    }
}
