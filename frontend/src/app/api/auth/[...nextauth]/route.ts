/**
 * NextAuth.js route handler.
 * Configures Google OAuth, exchanges ID token for a backend JWT,
 * and stores the backend token on the session for API calls.
 */

import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import type { JWT } from "next-auth/jwt";
import type { Session, Account, User } from "next-auth";

// const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";
  
const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],

  callbacks: {
    async jwt({
      token,
      account,
      user,
    }: {
      token: JWT;
      account: Account | null;
      user: User;
    }) {
      // On first sign-in, exchange Google ID token for backend JWT
      if (account?.id_token) {
        try {
          const res = await fetch(`${API_URL}/api/auth/google`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id_token: account.id_token }),
          });

          if (res.ok) {
            const data = (await res.json()) as {
              access_token: string;
              user: { avatar_url?: string };
            };
            token.accessToken = data.access_token;
            token.avatar_url = data.user?.avatar_url ?? undefined;
          }
        } catch (e) {
          console.error("Backend auth exchange failed", e);
        }
      }
      return token;
    },

    async session({ session, token }: { session: Session; token: JWT }) {
      session.accessToken = token.accessToken;
      if (session.user) {
        session.user.avatar_url = token.avatar_url;
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
  },

  session: {
    strategy: "jwt",
  },
});

export { handler as GET, handler as POST };
