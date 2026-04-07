/**
 * Uploaded file payload used when extracting and storing assets.
 */
export interface PresentationFilePayload {
    /** Original filename of the uploaded file (e.g. `deck.zip`). */
    filename: string;
    /** Temporary file path for the uploaded payload. */
    filePath: string;
    /** Exact file size in bytes. */
    byteLength: number;
}

/**
 * Data submitted by the uploader when creating a new presentation.
 */
export interface UploadPayload extends PresentationFilePayload {
    /** Display title for the presentation. */
    title: string;
    /** Plain-text password that will be hashed before storage. */
    password: string;
}

/**
 * Client-facing metadata returned after a presentation is unlocked.
 */
export interface PresentationManifest {
    /** Unique presentation identifier. */
    id: string;
    /** Display title. */
    title: string;
    /** URL-safe slug derived from the title. */
    slug: string;
    /** Relative path to the root HTML document inside the asset bundle. */
    entryFile: string;
    /** Base URL path for fetching presentation assets. */
    assetBasePath: string;
}
