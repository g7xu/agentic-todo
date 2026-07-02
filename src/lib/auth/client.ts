"use client";

import { createAuthClient } from "@neondatabase/auth/next";

/** Browser-side Neon Auth client (sign-in/out, session hooks). */
export const authClient = createAuthClient();
