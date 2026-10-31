/**
 * 認証まわりの処理（パスワード確認・トークンの発行と検証）
 * 権限の判定は必ずここ（Worker 側）で行い、画面側の判定は信用しない。
 */

/** 利用者の種類 */
export type Role = "viewer" | "admin";

/** トークンに入れる中身 */
interface TokenPayload {
  role: Role;
  exp: number; // 有効期限（UNIX 秒）
}

/** トークンの有効期間（秒）：閲覧者 7 日、管理者 2 時間 */
export const TOKEN_LIFETIME: Record<Role, number> = {
  viewer: 7 * 24 * 60 * 60,
  admin: 2 * 60 * 60,
};

const encoder = new TextEncoder();

/** バイト列を URL で使える Base64 文字列にする */
function toBase64Url(bytes: Uint8Array): string {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** URL 用 Base64 文字列をバイト列に戻す（不正な文字列なら null） */
function fromBase64Url(text: string): Uint8Array | null {
  try {
    const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** 署名鍵を読み込む（用途ごとに鍵を分けるため purpose を混ぜる） */
async function importKey(secret: string, purpose: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`${purpose}:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** 文字列に HMAC 署名を付ける */
export async function sign(secret: string, purpose: string, data: string): Promise<string> {
  const key = await importKey(secret, purpose);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return toBase64Url(new Uint8Array(signature));
}

/** 署名が正しいか確認する（時間差で推測されない比較方法） */
export async function verify(secret: string, purpose: string, data: string, signature: string): Promise<boolean> {
  const bytes = fromBase64Url(signature);
  if (!bytes) return false;
  const key = await importKey(secret, purpose);
  return crypto.subtle.verify("HMAC", key, bytes, encoder.encode(data));
}

/**
 * パスワードが一致するか確認する。
 * 長さの違いや一致した文字数から推測されないよう、両方をハッシュ化して比較する。
 */
export async function passwordMatches(input: string, expected: string): Promise<boolean> {
  if (!expected) return false; // Secret が未設定なら必ず失敗させる
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(input)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/** トークンを発行する */
export async function createToken(secret: string, role: Role): Promise<{ token: string; expiresAt: number }> {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_LIFETIME[role];
  const payload: TokenPayload = { role, exp };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await sign(secret, "token", body);
  return { token: `${body}.${signature}`, expiresAt: exp };
}

/** トークンを検証し、正しければ利用者の種類を返す（不正・期限切れなら null） */
export async function readToken(secret: string, token: string): Promise<Role | null> {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  if (!(await verify(secret, "token", body, signature))) return null;

  const bytes = fromBase64Url(body);
  if (!bytes) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Partial<TokenPayload>;
    if (payload.role !== "viewer" && payload.role !== "admin") return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
    return payload.role;
  } catch {
    return null;
  }
}

/**
 * リクエストの Authorization ヘッダーから利用者の種類を取り出す。
 * 管理者は閲覧者の操作もできる。
 */
export async function getRole(request: Request, secret: string): Promise<Role | null> {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  return readToken(secret, header.slice("Bearer ".length));
}

/** 必要な権限を満たしているか */
export function hasRole(actual: Role | null, required: Role): boolean {
  if (actual === "admin") return true;
  return actual === required;
}
