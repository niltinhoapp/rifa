const R20_PRIME_IMAGE =
  "https://static.wixstatic.com/media/acc37b_79f5e928245e4f8498b6ece85c2d8d2b~mv2.jpeg";

export const runtime = "nodejs";

export async function GET() {
  try {
    const image = await fetch(R20_PRIME_IMAGE, {
      headers: { Accept: "image/jpeg,image/*;q=0.9,*/*;q=0.8" },
      next: { revalidate: 86400 },
    });

    if (!image.ok) {
      return new Response("Imagem indisponível", { status: 502 });
    }

    const contentType = image.headers.get("content-type") ?? "image/jpeg";
    return new Response(await image.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Falha ao carregar imagem", { status: 502 });
  }
}
