import { z } from 'zod';

export const createPresentationSchema = z.object({
    title: z.string().trim().min(1).max(120),
    password: z.string().min(8).max(128),
});

export const unlockPresentationSchema = z.object({
    password: z.string().min(1).max(128),
});
