import { redirect } from "next/navigation";

// Creating starts in the chat on Home now; the content plan moved to /plan.
export default function CreatePage() {
  redirect("/");
}
