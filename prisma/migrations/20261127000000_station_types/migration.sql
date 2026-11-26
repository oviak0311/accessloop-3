-- New kinds of stations, added with the TTC and GO stop list.
-- AlterEnum
ALTER TYPE "LocationType" ADD VALUE 'LRT_STATION';
ALTER TYPE "LocationType" ADD VALUE 'GO_STATION';
