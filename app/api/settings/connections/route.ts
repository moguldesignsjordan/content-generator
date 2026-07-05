import { NextRequest, NextResponse } from "next/server";
import {
  deleteBrandIntegration,
  getBrandIntegration,
  getSingleBrand,
  upsertBrandIntegration,
} from "@/lib/db/queries";
import { getProvider, listProviders } from "@/lib/publishing/registry";
import { describeConnection } from "@/lib/publishing/connections";
import { encryptSecret } from "@/lib/crypto/secrets";

// Connections: per-brand publishing credentials (MailerLite API key, Sanity
// project/token). Secrets are encrypted at rest (lib/crypto/secrets.ts); this
// route never returns a decrypted secret, only a per-field "is set" boolean.
// Plain fields overwrite on PATCH; secret fields only overwrite (encrypt)
// when a non-empty value is submitted, so "leave blank to keep" works. A
// DELETE removes the connection row so the provider falls back to env vars.

/**
 * GET ?brandId= → every provider's label/kind/fields + describeConnection
 * output (state, plain values, secret-is-set booleans). Drives the initial
 * Settings → Connections render and the form's post-save refresh.
 */
export async function GET(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  if (!brandId) {
    return NextResponse.json({ error: "brandId is required." }, { status: 400 });
  }
  try {
    const brand = await getSingleBrand();
    if (!brand || brand.id !== brandId) {
      return NextResponse.json({ error: "Brand not found." }, { status: 404 });
    }
    const connections = await Promise.all(
      listProviders().map(async (p) => {
        const integration = await getBrandIntegration(brand.id, p.id);
        return {
          id: p.id,
          label: p.label,
          kind: p.kind,
          configHint: p.configHint,
          fields: p.fields,
          ...describeConnection(p, brand, integration),
        };
      }),
    );
    return NextResponse.json({ connections });
  } catch (err) {
    console.error("connections GET error", err);
    return NextResponse.json({ error: "Failed to load connections." }, { status: 500 });
  }
}

/**
 * PATCH { brandId, providerId, fields } → merges submitted fields into the
 * stored config (encrypting secrets only when non-empty) and upserts the row.
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      brandId: string;
      providerId: string;
      fields: Record<string, unknown>;
    };
    if (!body.brandId || !body.providerId) {
      return NextResponse.json(
        { error: "brandId and providerId are required." },
        { status: 400 },
      );
    }
    const provider = getProvider(body.providerId);
    if (!provider) {
      return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
    }
    const brand = await getSingleBrand();
    if (!brand || brand.id !== body.brandId) {
      return NextResponse.json({ error: "Brand not found." }, { status: 404 });
    }

    const existing = await getBrandIntegration(body.brandId, body.providerId);
    const config: Record<string, unknown> = { ...(existing?.config ?? {}) };

    // Plain fields overwrite; secret fields only overwrite (encrypt) when a
    // non-empty value is submitted, else the stored ciphertext is preserved.
    for (const f of provider.fields) {
      const submitted = body.fields?.[f.key];
      if (f.secret) {
        if (typeof submitted === "string" && submitted.trim()) {
          config[f.key] = encryptSecret(submitted.trim());
        }
      } else if (f.list) {
        config[f.key] = Array.isArray(submitted)
          ? submitted
              .filter((v): v is string => typeof v === "string" && v.trim() !== "")
              .map((v) => v.trim())
          : [];
      } else {
        config[f.key] = typeof submitted === "string" ? submitted.trim() : "";
      }
    }

    const integration = await upsertBrandIntegration(
      body.brandId,
      body.providerId,
      config,
    );
    return NextResponse.json({
      saved: true,
      ...describeConnection(provider, brand, integration),
    });
  } catch (err) {
    console.error("connections PATCH error", err);
    return NextResponse.json({ error: "Failed to save connection." }, { status: 500 });
  }
}

/** DELETE ?brandId=&providerId= (query params) → removes the connection row. */
export async function DELETE(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  const providerId = req.nextUrl.searchParams.get("providerId");
  if (!brandId || !providerId) {
    return NextResponse.json(
      { error: "brandId and providerId are required." },
      { status: 400 },
    );
  }
  try {
    await deleteBrandIntegration(brandId, providerId);
    return NextResponse.json({ saved: true });
  } catch (err) {
    console.error("connections DELETE error", err);
    return NextResponse.json({ error: "Failed to disconnect." }, { status: 500 });
  }
}
