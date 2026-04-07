import { describe, expect, it } from 'vitest';
import {
    createPresentationSchema,
    unlockPresentationSchema,
} from '../../../src/presentations/schema.js';

describe('presentation schemas', () => {
    describe('createPresentationSchema', () => {
        it('accepts valid payloads and trims the title', () => {
            const parsed = createPresentationSchema.parse({
                title: '  Demo Deck  ',
                password: 'super-secret-pass',
            });

            expect(parsed).toEqual({
                title: 'Demo Deck',
                password: 'super-secret-pass',
            });
        });

        it('rejects empty titles', () => {
            const parsed = createPresentationSchema.safeParse({
                title: '   ',
                password: 'super-secret-pass',
            });

            expect(parsed.success).toBe(false);
        });

        it('rejects titles longer than 120 characters', () => {
            const parsed = createPresentationSchema.safeParse({
                title: 'a'.repeat(121),
                password: 'super-secret-pass',
            });

            expect(parsed.success).toBe(false);
        });

        it('rejects passwords shorter than eight characters', () => {
            const parsed = createPresentationSchema.safeParse({
                title: 'Demo Deck',
                password: 'short',
            });

            expect(parsed.success).toBe(false);
        });

        it('rejects passwords longer than 128 characters', () => {
            const parsed = createPresentationSchema.safeParse({
                title: 'Demo Deck',
                password: 'a'.repeat(129),
            });

            expect(parsed.success).toBe(false);
        });
    });

    describe('unlockPresentationSchema', () => {
        it('accepts non-empty passwords', () => {
            const parsed = unlockPresentationSchema.parse({
                password: 'unlock-me',
            });

            expect(parsed).toEqual({
                password: 'unlock-me',
            });
        });

        it('rejects empty passwords', () => {
            const parsed = unlockPresentationSchema.safeParse({
                password: '',
            });

            expect(parsed.success).toBe(false);
        });

        it('rejects passwords longer than 128 characters', () => {
            const parsed = unlockPresentationSchema.safeParse({
                password: 'a'.repeat(129),
            });

            expect(parsed.success).toBe(false);
        });
    });
});
