/**
 * 動画共有サイトの API（Cloudflare Worker）
 * 認証・権限チェック・R2 へのアクセスはすべてここで行う。
 *
 * API 一覧
 *   GET  /api/health  動作確認
 *   POST /api/login   ログイン（閲覧者 / 管理者）
 *   GET  /api/me      ログイン状態の確認
 */
import { createToken, getRole, passwordMatches, type Role } from "./auth";

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
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(env),
    },
  });
}

/** アクセス元の IP アドレス（回数制限と不正アクセスの記録に使う） */
function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

/** ログを 1 行の JSON で出す（パスワードやトークンは絶対に渡さない） */
function log(level: "warn" | "error", event: string, detail: Record<string, string | number>): void {
  console[level](JSON.stringify({ event, ...detail }));
}

/**
 * POST /api/login
 * 送られたパスワードを確認し、正しければトークンを返す。
 */
async function handleLogin(request: Request, env: Env): Promise<Response> {
  const ip = clientIp(request);

  let body: { role?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(env, { error: "リクエストの形式が正しくありません" }, 400);
  }

  const role = body.role;
  const password = body.password;
  if ((role !== "viewer" && role !== "admin") || typeof password !== "string" || password.length > 200) {
    return json(env, { error: "リクエストの形式が正しくありません" }, 400);
  }

  // 回数制限は「種類 + IP」ごとに数える
  const { success } = await env.LOGIN_LIMITER.limit({ key: `${role}:${ip}` });
  if (!success) {
    log("warn", "login_rate_limited", { role, ip });
    return json(env, { error: "試行回数が多すぎます。1 分ほど待ってから再度お試しください" }, 429);
  }

  const expected = role === "admin" ? env.ADMIN_PASSWORD : env.VIEWER_PASSWORD;
  if (!(await passwordMatches(password, expected))) {
    log("warn", "login_failed", { role, ip });
    return json(env, { error: "パスワードが違います" }, 401);
  }

  const { token, expiresAt } = await createToken(env.TOKEN_SECRET, role as Role);
  return json(env, { token, role, expiresAt });
}

/**
 * GET /api/me
 * トークンが有効か確認し、利用者の種類を返す。
 */
async function handleMe(request: Request, env: Env): Promise<Response> {
  const role = await getRole(request, env.TOKEN_SECRET);
  if (!role) {
    return json(env, { error: "ログインが必要です" }, 401);
  }
  return json(env, { role });
}

export default {
  /** すべてのリクエストの入口 */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ブラウザの事前確認（CORS プリフライト）
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json(env, { ok: true });
      }
      if (url.pathname === "/api/login" && request.method === "POST") {
        return await handleLogin(request, env);
      }
      if (url.pathname === "/api/me" && request.method === "GET") {
        return await handleMe(request, env);
      }
      return json(env, { error: "Not Found" }, 404);
    } catch (error) {
      log("error", "worker_error", { path: url.pathname, message: String(error) });
      return json(env, { error: "サーバーでエラーが発生しました" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
