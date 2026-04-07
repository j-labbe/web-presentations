-- CreateTable
CREATE TABLE "Presentation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "storagePrefix" TEXT NOT NULL,
  "entryFile" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Presentation_slug_key" ON "Presentation"("slug");

-- CreateTable
CREATE TABLE "PresentationAccessSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "presentationId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PresentationAccessSession_presentationId_fkey"
    FOREIGN KEY ("presentationId")
    REFERENCES "Presentation"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PresentationAccessSession_tokenHash_key"
  ON "PresentationAccessSession"("tokenHash");
CREATE INDEX "PresentationAccessSession_presentationId_idx"
  ON "PresentationAccessSession"("presentationId");
CREATE INDEX "PresentationAccessSession_expiresAt_idx"
  ON "PresentationAccessSession"("expiresAt");
