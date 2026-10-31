/**
 * 動画共有サイトの API（Cloudflare Worker）
 * 認証・権限チェック・R2 へのアクセスはすべてここで行う。
 * 現時点は雛形のため、動作確認用の /api/health のみ実装している。
 */

/** Worker に渡される設定・バインディング */
export interface Env {
  BUCKET: R2Bucket;
  LOGIN_LIMITER: RateLimit;
  ALLOWED_ORIGIN: string;
  MAX_UPLOAD_MB: string;
  VIEWER_PASSWORD: string;
  ADMIN_PASSWORD: string;
  TOKEN_SECRET: string;
}

/** 許可したドメインからの呼び出しだけに付ける CORS ヘッダーを作る */
function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** JSON を返すときの共通処理 */
function json(env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(env) },
  });
}

export default {
  /** すべてのリクエストの入口 */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ブラウザの事前確認（CORS プリフライト）
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    // 動作確認用
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json(env, { ok: true });
    }

    return json(env, { error: "Not Found" }, 404);
  },
} satisfies ExportedHandler<Env>;
