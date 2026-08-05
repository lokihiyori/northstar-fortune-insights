import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl = process.env["DATABASE_URL"];

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Left unset when absent so the Prisma CLI reports a missing URL itself,
    // rather than failing later with an empty connection string.
    ...(databaseUrl ? { url: databaseUrl } : {}),
  },
});
