import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/features/auth/password";
import { SEED_SOURCE_COUNT, seedSources } from "./seed-sources";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/**
 * Phase 0 seed: one deterministic development user, enough to prove the seed
 * workflow runs. Richer fixtures (sample reports, reviewed resources, plan
 * fixtures — spec section 17) arrive with the phases that own those models.
 *
 * The admin account is created only when SEED_ADMIN=true, so a production
 * database can never be seeded with an elevated account by accident.
 */
// Local-only credentials. These accounts exist on developer machines; the guard
// below keeps the elevated one out of any database that is not explicitly opted in.
const DEV_PASSWORD = "northstar-dev-password";

async function main() {
  const passwordHash = await hashPassword(DEV_PASSWORD);

  const developer = await prisma.user.upsert({
    where: { email: "dev@northstar.local" },
    update: { passwordHash },
    create: {
      email: "dev@northstar.local",
      name: "Dev User",
      role: "USER",
      passwordHash,
      profile: { create: {} },
    },
  });
  console.log(`Seeded user ${developer.email} (password: ${DEV_PASSWORD})`);

  if (process.env["SEED_ADMIN"] === "true") {
    const admin = await prisma.user.upsert({
      where: { email: "admin@northstar.local" },
      update: { passwordHash },
      create: {
        email: "admin@northstar.local",
        name: "Admin User",
        role: "ADMIN",
        passwordHash,
        profile: { create: {} },
      },
    });
    console.log(`Seeded admin ${admin.email} (password: ${DEV_PASSWORD})`);
  } else {
    console.log("Skipped admin seed (set SEED_ADMIN=true to create one locally)");
  }

  // The reviewed corpus retrieval draws on. Without it every generated report
  // would be exploratory, because nothing could be cited.
  const chunks = await seedSources(prisma);
  console.log(`Seeded ${String(SEED_SOURCE_COUNT)} published sources (${String(chunks)} passages)`);
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
