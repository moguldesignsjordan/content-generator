import { NextRequest, NextResponse } from "next/server";
import { deleteProduct, upsertProduct } from "@/lib/db/queries";
import type { Product } from "@/lib/db/types";
import { logError } from "@/lib/log";

/** Creates or updates one product (keyed by brand_id + slug). */
export async function PATCH(req: NextRequest) {
  try {
    const { brandId, product } = (await req.json()) as {
      brandId?: string;
      product?: Partial<Product> & { slug?: string; name?: string };
    };
    if (!brandId || !product?.slug?.trim() || !product?.name?.trim()) {
      return NextResponse.json(
        { error: "brandId, product.slug, and product.name are required" },
        { status: 400 },
      );
    }
    const saved = await upsertProduct(brandId, {
      slug: product.slug.trim(),
      name: product.name.trim(),
      description: product.description?.trim() || null,
      deliverables: (product.deliverables ?? []).filter(Boolean),
      price_point: product.price_point?.trim() || null,
      url: product.url?.trim() || null,
      image_url: product.image_url?.trim() || null,
    });
    return NextResponse.json({ product: saved });
  } catch (err) {
    logError("api:/api/settings/products:patch", err);
    return NextResponse.json({ error: "Failed to save product" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { productId } = (await req.json()) as { productId?: string };
    if (!productId) {
      return NextResponse.json({ error: "productId is required" }, { status: 400 });
    }
    await deleteProduct(productId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    logError("api:/api/settings/products:delete", err);
    return NextResponse.json({ error: "Failed to delete product" }, { status: 500 });
  }
}
