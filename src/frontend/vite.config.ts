import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    root: resolve(__dirname),
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            '@': resolve(__dirname),
        },
    },
    build: {
        outDir: resolve(__dirname, '..', '..', 'dist', 'frontend'),
        emptyOutDir: true,
    },
    server: {
        port: 5173,
        proxy: {
            '/admin/auth': 'http://localhost:3000',
            '/admin/api': 'http://localhost:3000',
            '/presentations': 'http://localhost:3000',
            '/health': 'http://localhost:3000',
        },
    },
});
