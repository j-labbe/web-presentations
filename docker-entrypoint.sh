#!/bin/sh
set -e

# Persisted volume is mounted at /data; DB and assets live under it.
mkdir -p /data/presentations

# Ensure parent dir exists for SQLite (DATABASE_URL=file:/data/app.db)
DB_PATH="${DATABASE_URL#file:}"
if [ -n "$DB_PATH" ]; then
    mkdir -p "$(dirname "$DB_PATH")"
fi

npx prisma db push --skip-generate

exec node dist/src/server.js
