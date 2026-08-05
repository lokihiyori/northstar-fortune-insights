import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

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
async function main() {
  const developer = await prisma.user.upsert({
    where: { email: "dev@northstar.local" },
    update: {},
    create: {
      email: "dev@northstar.local",
      name: "Dev User",
      role: "USER",
    },
  });
  console.log(`Seeded user ${developer.email}`);

  if (process.env["SEED_ADMIN"] === "true") {
    const admin = await prisma.user.upsert({
      where: { email: "admin@northstar.local" },
      update: {},
      create: {
        email: "admin@northstar.local",
        name: "Admin User",
        role: "ADMIN",
      },
    });
    console.log(`Seeded admin ${admin.email}`);
  } else {
    console.log("Skipped admin seed (set SEED_ADMIN=true to create one locally)");
  }
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
