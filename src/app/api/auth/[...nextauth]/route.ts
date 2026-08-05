import { handlers } from "@/auth";

// Auth.js needs Node APIs (Prisma adapter, scrypt), so this cannot run on Edge.
export const runtime = "nodejs";

export const { GET, POST } = handlers;
