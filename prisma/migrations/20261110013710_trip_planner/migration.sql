/*
  Warnings:

  - A unique constraint covering the columns `[code]` on the table `locations` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "LocationType" ADD VALUE 'STOP';

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "locations_code_key" ON "locations"("code");
