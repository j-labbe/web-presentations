/**
 * Raised for client-controlled upload input that should produce a safe 4xx
 * response instead of an internal server error.
 */
export class PresentationValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PresentationValidationError';
    }
}
