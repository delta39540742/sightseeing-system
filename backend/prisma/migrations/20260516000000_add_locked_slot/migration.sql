-- AlterTable: add is_locked flag to trip_slot
ALTER TABLE "trip_slot" ADD COLUMN "is_locked" BOOLEAN NOT NULL DEFAULT false;
