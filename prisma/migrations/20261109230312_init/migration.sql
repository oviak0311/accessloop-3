-- CreateEnum
CREATE TYPE "Kind" AS ENUM ('EQUIPMENT', 'CONDITION', 'INFRASTRUCTURE');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('SUBWAY_STATION', 'BUS_STOP', 'STREETCAR_STOP');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('NORTHBOUND', 'SOUTHBOUND', 'EASTBOUND', 'WESTBOUND');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('REPORTED', 'UNDER_REVIEW', 'IN_PROGRESS', 'ACKNOWLEDGED', 'PLANNED', 'RESOLVED', 'CLEARED', 'BUILT', 'NOT_PLANNED', 'DUPLICATE', 'COULD_NOT_VERIFY');

-- CreateEnum
CREATE TYPE "ResponseValue" AS ENUM ('STILL_BROKEN', 'FIXED', 'STILL_PRESENT', 'CLEARED', 'STILL_MISSING', 'NOW_INSTALLED');

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "Kind" NOT NULL,
    "description" TEXT,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "spot" TEXT NOT NULL,
    "direction" "Direction",
    "line" TEXT,
    "type" "LocationType" NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" SERIAL NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "description" VARCHAR(1000),
    "severity" "Severity" NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'REPORTED',
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "editKeyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "duplicateOfId" INTEGER,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_history" (
    "id" SERIAL NOT NULL,
    "reportId" INTEGER NOT NULL,
    "oldStatus" "Status",
    "newStatus" "Status" NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "responses" (
    "id" SERIAL NOT NULL,
    "reportId" INTEGER NOT NULL,
    "value" "ResponseValue" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "locations_name_spot_direction_key" ON "locations"("name", "spot", "direction");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateIndex
CREATE INDEX "reports_locationId_idx" ON "reports"("locationId");

-- CreateIndex
CREATE INDEX "reports_categoryId_idx" ON "reports"("categoryId");

-- CreateIndex
CREATE INDEX "status_history_reportId_idx" ON "status_history"("reportId");

-- CreateIndex
CREATE INDEX "responses_reportId_idx" ON "responses"("reportId");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responses" ADD CONSTRAINT "responses_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
