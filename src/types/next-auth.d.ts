import type { UserRole } from "@/generated/prisma/enums";

// The imports are required: TypeScript can only augment a module it has
// resolved, and `next-auth/jwt` is otherwise never referenced by this project.
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    role?: UserRole;
  }

  interface Session {
    user: {
      id: string;
      role: UserRole;
      email: string;
      name?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: UserRole;
  }
}
