import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { cmsErrorResponse, cmsNet } from "@/lib/cmsServer";
import { publishWordPressPost } from "@/lib/domain/cms/wordpressPost";

/** Splits the generator's `---\ntitle:...\ndescription:...\n---\n<body>`
 * output — same shape ArticleAgentModal's parseArticle() reads client-side. */
function parseArticle(raw: string): { title: string | null; body: string } {
  const match = raw.match(/^---\s*\ntitle:\s*(.*)\ndescription:\s*(.*)\n---\s*\n([\s\S]*)$/);
  if (!match) return { title: null, body: raw };
  const [, title, , body] = match;
  return { title: title.trim(), body: body.trim() };
}

/** Minimal markdown → HTML: headings and paragraph breaks only. WordPress's
 * own wpautop filter handles plain-paragraph wrapping on render, but not
 * `#`-style headings, so those are converted explicitly; everything else is
 * passed through as-is (bold/links/lists render fine as literal markdown
 * text — full markdown rendering is a follow-up, not a Phase 2 blocker). */
function markdownToHtml(md: string): string {
  return md
    .split(/\n{2,}/)
    .map((block) => {
      const heading = block.match(/^(#{1,3})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        return `<h${level}>${heading[2].trim()}</h${level}>`;
      }
      return `<p>${block.trim()}</p>`;
    })
    .join("\n");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id: string | undefined = body?.id;
  if (!id) return NextResponse.json({ error: "Missing article id" }, { status: 400 });

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    const { data: article } = await db
      .from("articles")
      .select("id, topic, title, content")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!article) return NextResponse.json({ error: "Article not found." }, { status: 404 });

    const { data: conn } = await db
      .from("provider_connections")
      .select("api_key_secret_id, base_url")
      .eq("user_id", user.id)
      .eq("provider_id", "wordpress")
      .maybeSingle();
    if (!conn?.api_key_secret_id || !conn.base_url) {
      return NextResponse.json({ error: "WordPress isn't connected — connect it in Settings → Integrations." }, { status: 422 });
    }
    const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
    const combined = (secret as string) ?? "";
    if (!combined) return NextResponse.json({ error: "WordPress isn't connected — connect it in Settings → Integrations." }, { status: 422 });

    try {
      const { title, body: articleBody } = parseArticle(article.content);
      const postTitle = title ?? article.title ?? article.topic;
      const { publishedUrl } = await publishWordPressPost(
        { baseUrl: conn.base_url, credentials: combined, title: postTitle, html: markdownToHtml(articleBody) },
        cmsNet,
      );

      await db.from("articles").update({ status: "published", published_url: publishedUrl, published_at: new Date().toISOString() }).eq("id", id);

      return NextResponse.json({ publishedUrl });
    } catch (err) {
      return cmsErrorResponse(err, "Failed to publish to WordPress.");
    }
  }

  try {
    const db = getDb();
    const article = db.prepare("SELECT id, topic, title, content FROM articles WHERE id = ?").get(id) as
      | { id: string; topic: string; title: string | null; content: string }
      | undefined;
    if (!article) return NextResponse.json({ error: "Article not found." }, { status: 404 });

    const conn = db.prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = 'wordpress'").get() as
      | { api_key: string; base_url: string | null }
      | undefined;
    if (!conn?.api_key || !conn.base_url) {
      return NextResponse.json({ error: "WordPress isn't connected — connect it in Settings → Integrations." }, { status: 422 });
    }

    const { title, body: articleBody } = parseArticle(article.content);
    const postTitle = title ?? article.title ?? article.topic;
    const { publishedUrl } = await publishWordPressPost(
      { baseUrl: conn.base_url, credentials: conn.api_key, title: postTitle, html: markdownToHtml(articleBody) },
      cmsNet,
    );

    db.prepare("UPDATE articles SET status = 'published', published_url = ?, published_at = ? WHERE id = ?").run(
      publishedUrl,
      new Date().toISOString(),
      id
    );

    return NextResponse.json({ publishedUrl });
  } catch (err) {
    return cmsErrorResponse(err, "Failed to publish to WordPress.");
  }
}
