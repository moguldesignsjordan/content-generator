import { NextRequest, NextResponse } from "next/server";
import { updateCampaign } from "@/lib/db/queries";
import type { FactoryPlanItem } from "@/lib/db/types";
import { loadOwnFactoryCampaign } from "@/lib/factory/access";
import { loadUnitCosts, quotePlan } from "@/lib/pipeline/campaign-factory";
import { stripEmDashes } from "@/lib/text";
import { logError } from "@/lib/log";

type RowEdit = Partial<Pick<FactoryPlanItem, "title" | "hook" | "date" | "detail">>;

function cleanEdit(edit: unknown): RowEdit {
  const e = (edit ?? {}) as Record<string, unknown>;
  const out: RowEdit = {};
  const str = (v: unknown, max: number) =>
    typeof v === "string" ? stripEmDashes(v).trim().slice(0, max) : undefined;
  const title = str(e.title, 160);
  const hook = str(e.hook, 240);
  const detail = str(e.detail, 600);
  if (title) out.title = title;
  if (hook) out.hook = hook;
  if (detail !== undefined) out.detail = detail;
  if (typeof e.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.date)) out.date = e.date;
  return out;
}

/**
 * PATCH { edits?: { [rowId]: {title?, hook?, date?, detail?} }, remove?: [rowId] }:
 * saves plan-table edits and returns the re-priced plan. Only those four
 * fields are editable; kind and format stay as planned. Launched rows can't
 * be removed (their draft already exists).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const owned = await loadOwnFactoryCampaign(id);
    if (owned instanceof NextResponse) return owned;
    const { campaign, brandId } = owned;
    const factory = campaign.chat_state.factory!;

    const body = (await req.json().catch(() => ({}))) as {
      edits?: Record<string, unknown>;
      remove?: unknown;
    };
    const remove = new Set(
      (Array.isArray(body.remove) ? body.remove : []).filter(
        (x): x is string => typeof x === "string",
      ),
    );
    const edits = body.edits && typeof body.edits === "object" ? body.edits : {};

    const plan = (factory.plan ?? [])
      .filter((item) => item.draft_id || !remove.has(item.id))
      .map((item) =>
        item.draft_id || !(item.id in edits) ? item : { ...item, ...cleanEdit(edits[item.id]) },
      )
      .sort((a, b) => a.date.localeCompare(b.date));

    const quote = await quotePlan(plan, await loadUnitCosts(brandId));
    await updateCampaign(campaign.id, {
      chat_state: { ...campaign.chat_state, factory: { ...factory, plan, quote } },
    });
    return NextResponse.json({ plan, quote });
  } catch (err) {
    logError("api:/api/factory/[id]:patch", err);
    return NextResponse.json({ error: "Couldn't save the plan. Try again." }, { status: 500 });
  }
}
