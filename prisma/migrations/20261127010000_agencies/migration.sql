-- Stops from more transit agencies. Agencies reuse stop numbers (MiWay and the TTC can both
-- have a stop 1234), so a stop number now only has to be unique within one agency.

-- CreateEnum
CREATE TYPE "Agency" AS ENUM ('TTC', 'GO', 'MIWAY', 'BRAMPTON', 'YRT', 'DRT');

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "agency" "Agency";

-- DropIndex
DROP INDEX "locations_code_key";

-- CreateIndex
CREATE UNIQUE INDEX "locations_agency_code_key" ON "locations"("agency", "code");
