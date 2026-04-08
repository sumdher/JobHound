/**
 * Type augmentation for next-auth to include the backend JWT accessToken
 * and user profile fields on the session object.
 */

import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    user: {
      id?: string;
      avatar_url?: string;
    } & DefaultSession["user"];
  }

  interface User {
    accessToken?: string;
    avatar_url?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    avatar_url?: string;
  }
}
