export const transitions = {
    page: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] as const },
    card: { type: 'spring' as const, duration: 0.5, bounce: 0 },
    dialog: { type: 'spring' as const, duration: 0.35, bounce: 0 },
    stagger: { staggerChildren: 0.04 },
    row: { duration: 0.2, ease: 'easeOut' as const },
    header: { duration: 0.25, ease: 'easeOut' as const },
    progress: {
        type: 'spring' as const,
        stiffness: 100,
        damping: 20,
    },
};
