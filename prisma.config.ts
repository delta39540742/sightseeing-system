import "dotenv/config";
import { defineConfig } from "prisma/config";

const connectionString = process.env["DATABASE_URL"]!;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "ts-node prisma/seed.ts",
  },
  datasource: {
    url: connectionString,
  },
});
