import { redirect } from "next/navigation";

// Campaigns start in the chat on Home now (tap Campaign there).
export default function NewCampaignPage() {
  redirect("/");
}
