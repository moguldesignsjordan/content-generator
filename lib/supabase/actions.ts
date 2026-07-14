"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { createClient } from "./server";
import { REMEMBER_COOKIE } from "./remember";

/** Signs the user out and returns them to the login screen. */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

export type SignInState = { error: string } | null;

/**
 * Password sign-in as a server action, so the Supabase auth cookie is set via
 * a real Set-Cookie response header instead of browser document.cookie —
 * Safari/ITP caps script-written cookies at 7 days, which is the likeliest
 * cause of unwanted re-logins. Also persists (or clears) the "remember me"
 * choice used by lib/supabase/remember.ts to keep the session across a full
 * browser close, or let it die with the browser when unchecked.
 */
export async function signInWithPassword(_prevState: SignInState, formData: FormData): Promise<SignInState> {
  const email = formData.get("email")?.toString().trim();
  const password = formData.get("password")?.toString();
  const remember = formData.get("remember") === "on";
  const redirectTo = formData.get("redirectTo")?.toString() || "/";

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient({ remember });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: error.message };
  }

  const cookieStore = await cookies();
  if (remember) {
    cookieStore.set(REMEMBER_COOKIE, "1", {
      path: "/",
      maxAge: 400 * 24 * 60 * 60,
      sameSite: "lax",
    });
  } else {
    cookieStore.delete(REMEMBER_COOKIE);
  }

  redirect(redirectTo);
}
