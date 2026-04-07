# Presentation Upload API

Fastify + TypeScript API for uploading HTML presentation bundles to S3-compatible storage and serving them behind per-presentation passwords.

## Features

- Upload `.html` or `.zip` presentations through `POST /presentations`.
- Authenticate uploads with per-principal credentials instead of a shared key.
- Keep presentation assets in a private S3 bucket.
- Hash per-presentation passwords with Argon2.
- Unlock with `POST /presentations/:id/unlock` (sets an httpOnly cookie; response JSON is `{ expiresAt }` only). Manifest and assets accept that cookie or `Authorization: Bearer <token>` from the `Set-Cookie` value for API clients.
- Rate-limit upload and unlock attempts to reduce brute force risk.

## Docker

Build the image from the [Dockerfile](Dockerfile):

```bash
docker build -t presentations .
```

Persist the **SQLite database** and **presentation files** by mounting a volume (or host directory) at `/data` and pointing the app at paths under it:

```bash
docker volume create presentations-data

docker run -d --name presentations \
  -p 3000:3000 \
  -v presentations-data:/data \
  -e HOST=0.0.0.0 \
  -e NODE_ENV=production \
  -e DATABASE_URL=file:/data/app.db \
  -e LOCAL_ASSETS_ROOT=/data/presentations \
  -e JWT_SECRET=your-at-least-32-char-secret \
  -e UPLOAD_PRINCIPALS='[{"username":"deploy-bot","passwordHash":"$argon2id$..."}]' \
  presentations
```

Use single quotes around `UPLOAD_PRINCIPALS` in the shell so `$` in the Argon2 hash is preserved. Adjust other env vars as in [.env.example](.env.example) (`UPLOAD_MAX_BYTES`, `UNLOCK_TOKEN_TTL_SECONDS`, etc.) with extra `-e` flags or `--env-file` pointing at a file.

## Local setup

1. Copy env file:

    ```bash
    cp .env.example .env
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

3. Generate Prisma client:

    ```bash
    npm run prisma:generate
    ```

4. Apply database migration against your PostgreSQL:

    ```bash
    npx prisma migrate deploy
    ```

5. Generate an Argon2 hash for an upload principal password and place it in
   `UPLOAD_PRINCIPALS`:

    ```bash
    npm run genpass -- your-plain-password
    ```

    The `--` separates npm’s arguments from the password (required if the password contains flags).

6. Start the service:

    ```bash
    npm run dev
    ```

## API examples

Upload a presentation:

```bash
curl -X POST "http://localhost:3000/presentations" \
  -u "deploy-bot:upload-pass-123" \
  -F "title=Quarterly Update" \
  -F "password=deck-password-123" \
  -F "file=@./deck.zip"
```

Unlock (saves the access cookie to `cookies.txt`):

```bash
curl -c cookies.txt -X POST "http://localhost:3000/presentations/<presentationId>/unlock" \
  -H "content-type: application/json" \
  -d '{"password":"deck-password-123"}'
```

Fetch manifest:

```bash
curl -b cookies.txt "http://localhost:3000/presentations/<presentationId>/manifest"
```

Fetch a protected asset:

```bash
curl -b cookies.txt "http://localhost:3000/presentations/<presentationId>/assets/index.html"
```

To use a bearer token instead, copy the `presentation_access_token` value from `Set-Cookie` after unlock and pass `-H "authorization: Bearer <token>"`.

## Testing

```bash
npm test
```
