import { NextRequest, NextResponse } from "next/server";
import {
  createDesignLook,
  getHouseStyleExamples,
  getSingleBrand,
  listDesignLooks,
} from "@/lib/db/queries";
import { extractLookProfile } from "@/lib/pipeline/extract-look";
import { cleanExamples, cleanLookName, storageHostFromEnv } from "@/lib/looks";
import { guardAiRoute } from "@/lib/ai-guard";
import { logError } from "@/lib/log";
import { getSessionUser } from "@/lib/supabase/server";

// Reading a look's examples is one Sonnet vision call over up to 6 images.
export const maxDuration = 120;

/** GET: the brand's saved looks, default first, plus `house`: the brand's own
 * flyers, which "our style" follows whenever no look is the default. */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const brand = await getSingleBrand(user.id);
    if (!brand) return NextResponse.json({ looks: [], house: [] });
    const [looks, house] = await Promise.all([
      listDesignLooks(brand.id),
      getHouseStyleExamples(brand.id),
    ]);
    return NextResponse.json({ looks, house });
  } catch (err) {
    logError("api:/api/looks:get", err);
    return NextResponse.json({ error: "Couldn't load your looks." }, { status: 500 });
  }
}

/** POST { name, examples, is_default }: saves a look and reads its design once. */
export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const brand = await getSingleBrand(user.id);
    if (!brand) return NextResponse.json({ error: "No brand found." }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = cleanLookName(body.name);
    const examples = cleanExamples(body.examples, storageHostFromEnv());
    if (!name) return NextResponse.json({ error: "Give the look a name." }, { status: 400 });
    if (!examples) {
      return NextResponse.json({ error: "Add at least one example image." }, { status: 400 });
    }
    const guard = await guardAiRoute("look-profile", { brandId: brand.id, limit: 6 });
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error, outOfCredits: guard.outOfCredits ?? false }, { status: guard.status });
    }

    const profile = await extractLookProfile(examples, brand.id);
    const look = await createDesignLook({
      brandId: brand.id,
      name,
      examples,
      profile,
      isDefault: body.is_default === true,
    });
    return NextResponse.json({ look });
  } catch (err) {
    logError("api:/api/looks:post", err);
    return NextResponse.json({ error: "Couldn't save the look. Try again." }, { status: 500 });
  }
}
