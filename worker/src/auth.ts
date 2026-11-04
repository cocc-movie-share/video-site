/**
 * 認証まわりの処理（管理者パスワードの確認・トークンの発行と検証）
 * 閲覧はログイン不要。ログインが必要なのは管理者だけ。
 * 権限の判定は必ずここ（Worker 側）で行い、画面側の判定は信用しない。
 */

/** トークンに入れる中身 */
interface TokenPayload {
  role: "admin";
  exp: number; // 有効期限（UNIX 秒）
}

/** 管理者トークンの有効期間（秒）：2 時間 */
const TOKEN_LIFETIME = 2 * 60 * 60;

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

/** 管理者トークンを発行する */
export async function createAdminToken(secret: string): Promise<{ token: string; expiresAt: number }> {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_LIFETIME;
  const payload: TokenPayload = { role: "admin", exp };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await sign(secret, "token", body);
  return { token: `${body}.${signature}`, expiresAt: exp };
}

/** トークンを検証し、正しい管理者トークンなら true（不正・期限切れなら false） */
async function isValidAdminToken(secret: string, token: string): Promise<boolean> {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return false;
  if (!(await verify(secret, "token", body, signature))) return false;

  const bytes = fromBase64Url(body);
  if (!bytes) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Partial<TokenPayload>;
    return payload.role === "admin" && typeof payload.exp === "number" && payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

/**
 * リクエストの Authorization ヘッダーを確認する
 * @returns "admin"：正しい管理者トークン / "invalid"：トークンはあるが不正 / "none"：トークンなし
 */
export async function checkAdmin(request: Request, secret: string): Promise<"admin" | "invalid" | "none"> {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return "none";
  return (await isValidAdminToken(secret, header.slice("Bearer ".length))) ? "admin" : "invalid";
}
