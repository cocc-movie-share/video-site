/**
 * 動画の一覧・署名付き URL・配信の処理
 *
 * R2 内の保存場所
 *   _config/settings.json                         チーム・フォルダの一覧
 *   videos/<フォルダ>/<チーム(任意)>/<ファイル名>   動画
 *   thumbs/<フォルダ>/<チーム(任意)>/<ファイル名>.jpg サムネイル
 */
import { sign, verify } from "./auth";

/** 再生・保存用 URL の有効期間（秒） */
const MEDIA_URL_LIFETIME = 10 * 60;
/** サムネイル用 URL の有効期間（秒）：一覧を開いている間は表示できるよう長めにする */
const THUMB_URL_LIFETIME = 60 * 60;

/** _config/settings.json の中身 */
export interface Settings {
  teams: string[];
  folders: string[];
}

/** 一覧で返す動画 1 件分 */
interface VideoItem {
  key: string;
  folder: string;
  team: string | null;
  name: string;
  size: number;
  uploaded: string;
  thumbUrl: string | null;
}

/** 設定ファイルを読み込む（まだ無ければ空の設定を返す） */
export async function readSettings(bucket: R2Bucket): Promise<Settings> {
  const object = await bucket.get("_config/settings.json");
  if (!object) return { teams: [], folders: [] };
  const data = (await object.json()) as Partial<Settings>;
  return {
    teams: Array.isArray(data.teams) ? data.teams : [],
    folders: Array.isArray(data.folders) ? data.folders : [],
  };
}

/** 設定ファイルを保存する */
export async function writeSettings(bucket: R2Bucket, settings: Settings): Promise<void> {
  await bucket.put("_config/settings.json", JSON.stringify(settings, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
}

/** 指定した場所以下のファイル名をすべて取得する（1000 件を超えても続きを読む） */
export async function listAll(bucket: R2Bucket, prefix: string): Promise<R2Object[]> {
  const result: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, include: ["httpMetadata"] });
    result.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return result;
}

/** 動画の保存場所（key）からフォルダ・チーム・ファイル名を取り出す */
export function parseVideoKey(key: string): { folder: string; team: string | null; name: string } | null {
  const parts = key.split("/"); // ["videos", フォルダ, (チーム), ファイル名]
  if (parts.length === 3) return { folder: parts[1], team: null, name: parts[2] };
  if (parts.length === 4) return { folder: parts[1], team: parts[2], name: parts[3] };
  return null;
}

/** 動画 key に対応するサムネイルの key */
export function thumbKeyOf(videoKey: string): string {
  return `thumbs/${videoKey.slice("videos/".length)}.jpg`;
}

/**
 * 署名付きの配信 URL を作る
 * @param origin Worker 自身の URL（例：https://xxx.workers.dev）
 * @param download true なら端末に保存させる
 */
async function mediaUrl(secret: string, origin: string, key: string, lifetime: number, download: boolean): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + lifetime;
  const dl = download ? "1" : "0";
  const sig = await sign(secret, "media", `${key}|${exp}|${dl}`);
  const params = new URLSearchParams({ key, exp: String(exp), dl, sig });
  return `${origin}/media?${params.toString()}`;
}

/**
 * 動画一覧を作る
 * team を指定するとそのチームの動画と、チーム分けしていない動画を返す。
 */
export async function listVideos(bucket: R2Bucket, secret: string, origin: string, team: string | null): Promise<VideoItem[]> {
  const [videos, thumbs] = await Promise.all([listAll(bucket, "videos/"), listAll(bucket, "thumbs/")]);
  const thumbKeys = new Set(thumbs.map((t) => t.key));

  const items: VideoItem[] = [];
  for (const object of videos) {
    const info = parseVideoKey(object.key);
    if (!info) continue;
    if (team && info.team && info.team !== team) continue;

    const thumbKey = thumbKeyOf(object.key);
    items.push({
      key: object.key,
      ...info,
      size: object.size,
      uploaded: object.uploaded.toISOString(),
      thumbUrl: thumbKeys.has(thumbKey) ? await mediaUrl(secret, origin, thumbKey, THUMB_URL_LIFETIME, false) : null,
    });
  }
  // 新しい順に並べる
  items.sort((a, b) => b.uploaded.localeCompare(a.uploaded));
  return items;
}

/** 再生用と保存用の URL を発行する（動画が存在しなければ null） */
export async function createPlayUrls(
  bucket: R2Bucket,
  secret: string,
  origin: string,
  key: string,
): Promise<{ playUrl: string; downloadUrl: string } | null> {
  if (!key.startsWith("videos/") || !parseVideoKey(key)) return null;
  if (!(await bucket.head(key))) return null;
  return {
    playUrl: await mediaUrl(secret, origin, key, MEDIA_URL_LIFETIME, false),
    downloadUrl: await mediaUrl(secret, origin, key, MEDIA_URL_LIFETIME, true),
  };
}

/** 保存時のファイル名ヘッダーを作る（日本語名にも対応し、改行などは除く） */
function contentDisposition(name: string): string {
  const safe = name.replace(/[\r\n"\\]/g, "_");
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/**
 * GET /media
 * 署名と期限を確認してから R2 のファイルを返す。シーク用の Range 指定にも対応する。
 */
export async function serveMedia(request: Request, bucket: R2Bucket, secret: string): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const key = params.get("key") ?? "";
  const exp = params.get("exp") ?? "";
  const dl = params.get("dl") ?? "";
  const sig = params.get("sig") ?? "";

  const validKey = (key.startsWith("videos/") || key.startsWith("thumbs/")) && !key.includes("..");
  const notExpired = Number(exp) > Date.now() / 1000;
  if (!validKey || !notExpired || (dl !== "0" && dl !== "1")) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!(await verify(secret, "media", `${key}|${exp}|${dl}`, sig))) {
    return new Response("Forbidden", { status: 403 });
  }

  const object = await bucket.get(key, { range: request.headers });
  if (!object) return new Response("Not Found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, max-age=600");
  headers.set("X-Content-Type-Options", "nosniff");
  if (dl === "1") headers.set("Content-Disposition", contentDisposition(key.split("/").pop() ?? "video"));

  // Range 指定があれば 206（一部分）で返す
  const range = object.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (request.headers.has("Range") && range) {
    const start = range.suffix !== undefined ? object.size - range.suffix : (range.offset ?? 0);
    const length = range.suffix !== undefined ? range.suffix : (range.length ?? object.size - start);
    headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}
