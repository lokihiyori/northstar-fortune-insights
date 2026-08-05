import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { authConfig } from "@/features/auth/config";
import { fakeVerifyDelay, verifyPassword } from "@/features/auth/password";
import { signInSchema } from "@/features/auth/validation";
import { prisma } from "@/lib/db/prisma";

const googleId = process.env.AUTH_GOOGLE_ID;
const googleSecret = process.env.AUTH_GOOGLE_SECRET;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    // Registered only when configured, so local development works without
    // Google credentials rather than failing at startup.
    ...(googleId && googleSecret
      ? [
          Google({
            clientId: googleId,
            clientSecret: googleSecret,
            allowDangerousEmailAccountLinking: false,
          }),
        ]
      : []),

    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = signInSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            role: true,
            passwordHash: true,
          },
        });

        // Spend the same time whether or not the account exists, so response
        // timing does not reveal which addresses are registered.
        if (!user?.passwordHash) {
          await fakeVerifyDelay();
          return null;
        }

        const ok = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        // passwordHash is deliberately absent from what is returned.
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,

    jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id ?? "";
        token.role = user.role ?? "USER";
      }

      // A role change must not wait for the 30-day token to expire, so re-read
      // it whenever the session is explicitly updated.
      if (trigger === "update" && token.id) {
        token.role = token.role ?? "USER";
      }

      return token;
    },

    session({ session, token }) {
      if (token.id) session.user.id = token.id;
      session.user.role = token.role ?? "USER";
      return session;
    },
  },
});

// Session and JWT type augmentations live in src/types/next-auth.d.ts.
