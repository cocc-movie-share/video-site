/**
 * 管理者向け API（すべて管理者トークンが必要。確認は index.ts で行う）
 *
 *   GET  /api/admin/settings          大会・チーム一覧
 *   POST /api/admin/folders/add       大会を追加 {name}
 *   POST /api/admin/folders/delete    大会を削除 {name}（動画が無いときだけ）
 *   POST /api/admin/teams/add         チームを追加 {name}
 *   POST /api/admin/teams/delete      チームを削除 {name}（動画が無いときだけ）
 *   POST /api/admin/rename            名前を変更 {type: "folder"|"team", from, to}（少しずつ移動し done で完了）
 *   POST /api/admin/videos/move       動画のチームを変更 {key, team}
 *   POST /api/admin/videos/delete     動画を削除 {key}
 *   POST /api/admin/upload/start      アップロード開始 {folder, team, fileName, size}
 *   PUT  /api/admin/upload/part       分割データを送る ?key=&uploadId=&partNumber=
 *   POST /api/admin/upload/complete   アップロード完了 {key, uploadId, parts}
 *   POST /api/admin/upload/abort      アップロード中止 {key, uploadId}
 *   PUT  /api/admin/thumb             サムネイル保存 ?key=
 */
import type { Env } from "./index";
import { listAll, parseVideoKey, readSettings, thumbKeyOf, writeSettings } from "./videos";

/** 分割アップロード 1 回分のサイズ（Worker が一度に受け取れる上限より小さくする） */
export const PART_SIZE = 50 * 1024 * 1024;
/** サムネイルの上限サイズ */
const MAX_THUMB_BYTES = 1024 * 1024;
/** リネーム 1 回の呼び出しで移動する動画の数（Worker の処理回数の上限を超えないため） */
const RENAME_BATCH = 20;

/** 利用者に見せるエラー（メッセージをそのまま画面に出す） */
export class AdminError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** API の結果 */
export interface AdminResult {
  status: number;
  body: unknown;
}

/** 成功時の結果を作る */
function ok(body: unknown = { ok: true }): AdminResult {
  return { status: 200, body };
}

/**
 * 大会名・チーム名として使えるか確認する
 * 保存場所の区切りになる / や \、.. などは使えない。
 */
function validName(value: unknown, label: string, maxLength = 50): string {
  if (typeof value !== "string" || value.trim() === "") throw new AdminError(`${label}を入力してください`);
  const name = value.trim();
  if (name.length > maxLength) throw new AdminError(`${label}は${maxLength}文字以内にしてください`);
  const hasControlChar = [...name].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);
  if (/[/\\]/.test(name) || hasControlChar || name.startsWith(".")) {
    throw new AdminError(`${label}に使えない文字が含まれています（/ \\ や先頭の . など）`);
  }
  return name;
}

/** 動画のファイル名を確認し、保存時の種類（Content-Type）を決める */
function validFileName(value: unknown): { name: string; contentType: string } {
  const name = validName(value, "ファイル名", 100);
  const lower = name.toLowerCase();
  if (lower.endsWith(".mp4")) return { name, contentType: "video/mp4" };
  if (lower.endsWith(".mov")) return { name, contentType: "video/quicktime" };
  throw new AdminError("アップロードできるのは mp4 / mov だけです");
}

/** 大会・チーム・ファイル名から動画の保存場所を作る */
function videoKey(folder: string, team: string | null, name: string): string {
  return team ? `videos/${folder}/${team}/${name}` : `videos/${folder}/${name}`;
}

/** 送られてきた動画の保存場所が正しい形か確認する */
function checkVideoKey(value: unknown): { key: string; folder: string; team: string | null; name: string } {
  const info = typeof value === "string" && value.startsWith("videos/") ? parseVideoKey(value) : null;
  if (!info) throw new AdminError("動画の指定が正しくありません");
  validName(info.folder, "大会名");
  if (info.team) validName(info.team, "チーム名");
  validFileName(info.name);
  return { key: value as string, ...info };
}

/** ファイルの先頭を見て mp4 / mov の形式か確認する（拡張子だけ変えたファイルを防ぐ） */
function looksLikeVideo(data: ArrayBuffer): boolean {
  if (data.byteLength < 12) return false;
  const box = new TextDecoder().decode(new Uint8Array(data, 4, 4));
  return ["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(box);
}

/** JPEG 画像か確認する */
function looksLikeJpeg(data: ArrayBuffer): boolean {
  const b = new Uint8Array(data, 0, Math.min(3, data.byteLength));
  return b.length === 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/** リクエストの JSON を読む */
async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const data = await request.json();
    if (data && typeof data === "object") return data as Record<string, unknown>;
  } catch {
    // 下でエラーにする
  }
  throw new AdminError("リクエストの形式が正しくありません");
}

/**
 * R2 内でファイルを移動する（コピーしてから元を消す）
 * @returns 元のファイルが無ければ false
 */
async function moveObject(bucket: R2Bucket, from: string, to: string): Promise<boolean> {
  const source = await bucket.get(from);
  if (!source) return false;
  const { readable, writable } = new FixedLengthStream(source.size);
  await Promise.all([source.body.pipeTo(writable), bucket.put(to, readable, { httpMetadata: source.httpMetadata })]);
  await bucket.delete(from);
  return true;
}

/** 動画とサムネイルをまとめて移動する（移動先に同じ名前があれば中止） */
async function moveVideo(bucket: R2Bucket, from: string, to: string): Promise<void> {
  if (await bucket.head(to)) throw new AdminError(`移動先に同じ名前の動画があります（${to.split("/").pop()}）`, 409);
  if (!(await moveObject(bucket, from, to))) throw new AdminError("動画が見つかりません", 404);
  await moveObject(bucket, thumbKeyOf(from), thumbKeyOf(to));
}

/** 大会を追加する（新しい大会が一覧の先頭に来るようにする） */
async function addFolder(env: Env, body: Record<string, unknown>): Promise<AdminResult> {
  const name = validName(body.name, "大会名");
  const settings = await readSettings(env.BUCKET);
  if (settings.folders.includes(name)) throw new AdminError("同じ名前の大会がすでにあります", 409);
  settings.folders.unshift(name);
  await writeSettings(env.BUCKET, settings);
  return ok(settings);
}

/** 大会を削除する（動画が残っている場合は削除しない） */
async function deleteFolder(env: Env, body: Record<string, unknown>): Promise<AdminResult> {
  const name = validName(body.name, "大会名");
  const inside = await env.BUCKET.list({ prefix: `videos/${name}/`, limit: 1 });
  if (inside.objects.length > 0) throw new AdminError("動画が入っているため削除できません。先に動画を削除してください", 409);
  const settings = await readSettings(env.BUCKET);
  settings.folders = settings.folders.filter((f) => f !== name);
  await writeSettings(env.BUCKET, settings);
  return ok(settings);
}

/** チームを追加する */
async function addTeam(env: Env, body: Record<string, unknown>): Promise<AdminResult> {
  const name = validName(body.name, "チーム名");
  const settings = await readSettings(env.BUCKET);
  if (settings.teams.includes(name)) throw new AdminError("同じ名前のチームがすでにあります", 409);
  settings.teams.push(name);
  await writeSettings(env.BUCKET, settings);
  return ok(settings);
}

/** チームを削除する（そのチームの動画が残っている場合は削除しない） */
async function deleteTeam(env: Env, body: Record<string, unknown>): Promise<AdminResult> {
  const name = validName(body.name, "チーム名");
  const videos = await listAll(env.BUCKET, "videos/");
  if (videos.some((v) => parseVideoKey(v.key)?.team === name)) {
    throw new AdminError("このチームの動画が残っているため削除できません。先に動画を移動か削除してください", 409);
  }
  const settings = await readSettings(env.BUCKET);
  settings.teams = settings.teams.filter((t) => t !== name);
  await writeSettings(env.BUCKET, settings);
  return ok(settings);
}

/**
 * 大会名・チーム名を変更する
 * 動画の保存場所も変わるため、1 回に RENAME_BATCH 本ずつ移動する。
 * 画面側は done が true になるまで同じ内容で呼び続ける。
 */
async function rename(env: Env, body: Record<string, unknown>): Promise<AdminResult> {
  const type = body.type;
  if (type !== "folder" && type !== "team") throw new AdminError("変更する種類が正しくありません");
  const label = type === "folder" ? "大会名" : "チーム名";
  const from = validName(body.from, label);
  const to = validName(body.to, label);
  if (from === to) throw new AdminError("新しい名前が今の名前と同じです");

  const settings = await readSettings(env.BUCKET);
  const list = type === "folder" ? settings.folders : settings.teams;
  if (!list.includes(from)) throw new AdminError(`変更元の${label}が見つかりません`, 404);
  if (list.includes(to)) throw new AdminError(`同じ名前の${label}がすでにあります`, 409);

  // 今回移動する動画を選ぶ
  let targets: string[];
  let remaining: boolean;
  if (type === "folder") {
    const page = await env.BUCKET.list({ prefix: `videos/${from}/`, limit: RENAME_BATCH });
    targets = page.objects.map((o) => o.key);
    remaining = page.truncated;
  } else {
    const all = (await listAll(env.BUCKET, "videos/")).map((o) => o.key).filter((k) => parseVideoKey(k)?.team === from);
    targets = all.slice(0, RENAME_BATCH);
    remaining = all.length > RENAME_BATCH;
  }

  for (const key of targets) {
    const info = parseVideoKey(key);
    if (!info) continue;
    const newKey = type === "folder" ? videoKey(to, info.team, info.name) : videoKey(info.folder, to, info.name);
    await moveVideo(env.BUCKET, key, newKey);
  }

  // すべて移動し終わったら設定ファイルの名前を変える
  if (!remaining) {
    const index = list.indexOf(from);
    list[index] = to;
    await writeSettings(env.BUCKET, settings);
  }
  return ok({ done: !remaining, moved: targets.length });
}

/** 動画のチームを変更する（同じ大会の中で移動する） */
async function moveVideoTeam(env: Env, body: Record<string, unknown>): Promise<AdminResult> {
  const video = checkVideoKey(body.key);
  let team: string | null = null;
  if (body.team !== null && body.team !== "") {
    team = validName(body.team, "チーム名");
    const settings = await readSettings(env.BUCKET);
    if (!settings.teams.includes(team)) throw new AdminError("チームが見つかりません", 404);
  }
  const newKey = videoKey(video.folder, team, video.name);
  if (newKey === video.key) throw new AdminError("すでにそのチームに入っています");
  await moveVideo(env.BUCKET, video.key, newKey);
  return ok({ key: newKey });
}

/** 動画とサムネイルを削除する */
async function deleteVideo(env: Env, body: Record<string, unknown>): Promise<AdminResult> {
  const video = checkVideoKey(body.key);
  await env.BUCKET.delete([video.key, thumbKeyOf(video.key)]);
  return ok();
}

/** アップロードの上限サイズ（バイト） */
function maxUploadBytes(env: Env): number {
  return Number(env.MAX_UPLOAD_MB) * 1024 * 1024;
}

/** アップロードを始める（R2 に分割アップロードの受付を作る） */
async function uploadStart(env: Env, body: Record<string, unknown>): Promise<AdminResult> {
  const folder = validName(body.folder, "大会名");
  const settings = await readSettings(env.BUCKET);
  if (!settings.folders.includes(folder)) throw new AdminError("大会が見つかりません。先に大会を追加してください", 404);

  let team: string | null = null;
  if (body.team !== null && body.team !== undefined && body.team !== "") {
    team = validName(body.team, "チーム名");
    if (!settings.teams.includes(team)) throw new AdminError("チームが見つかりません。先にチームを追加してください", 404);
  }

  const { name, contentType } = validFileName(body.fileName);
  const size = body.size;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) throw new AdminError("ファイルサイズが正しくありません");
  if (size > maxUploadBytes(env)) throw new AdminError(`ファイルが大きすぎます（上限 ${env.MAX_UPLOAD_MB}MB）`, 413);

  const key = videoKey(folder, team, name);
  if (await env.BUCKET.head(key)) throw new AdminError(`同じ名前の動画がすでにあります（${name}）`, 409);

  const upload = await env.BUCKET.createMultipartUpload(key, { httpMetadata: { contentType } });
  return ok({ key, uploadId: upload.uploadId, partSize: PART_SIZE, partCount: Math.ceil(size / PART_SIZE) });
}

/** 分割したデータを 1 つ受け取って R2 に渡す */
async function uploadPart(request: Request, env: Env, url: URL): Promise<AdminResult> {
  const { key } = checkVideoKey(url.searchParams.get("key"));
  const uploadId = url.searchParams.get("uploadId") ?? "";
  const partNumber = Number(url.searchParams.get("partNumber"));
  const maxParts = Math.ceil(maxUploadBytes(env) / PART_SIZE);
  if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > maxParts) {
    throw new AdminError("リクエストの形式が正しくありません");
  }
  if (Number(request.headers.get("Content-Length") ?? 0) > PART_SIZE) throw new AdminError("データが大きすぎます", 413);

  const data = await request.arrayBuffer();
  if (data.byteLength === 0 || data.byteLength > PART_SIZE) throw new AdminError("データの大きさが正しくありません", 413);

  const upload = env.BUCKET.resumeMultipartUpload(key, uploadId);
  if (partNumber === 1 && !looksLikeVideo(data)) {
    await upload.abort().catch(() => {});
    throw new AdminError("動画ファイル（mp4 / mov）ではないため受け付けられません", 415);
  }
  const part = await upload.uploadPart(partNumber, data);
  return ok({ partNumber: part.partNumber, etag: part.etag });
}

/** すべてのデータを送り終えたら 1 つのファイルにまとめる */
async function uploadComplete(env: Env, body: Record<string, unknown>): Promise<AdminResult> {
  const { key } = checkVideoKey(body.key);
  const uploadId = typeof body.uploadId === "string" ? body.uploadId : "";
  const parts = Array.isArray(body.parts) ? body.parts : [];
  const valid = parts.every((p) => typeof p?.partNumber === "number" && typeof p?.etag === "string");
  if (!uploadId || parts.length === 0 || !valid) throw new AdminError("リクエストの形式が正しくありません");

  const upload = env.BUCKET.resumeMultipartUpload(key, uploadId);
  const object = await upload.complete(parts as R2UploadedPart[]);
  if (object.size > maxUploadBytes(env)) {
    await env.BUCKET.delete(key);
    throw new AdminError(`ファイルが大きすぎます（上限 ${env.MAX_UPLOAD_MB}MB）`, 413);
  }
  return ok({ key, size: object.size });
}

/** アップロードを中止する（途中のデータを捨てる） */
async function uploadAbort(env: Env, body: Record<string, unknown>): Promise<AdminResult> {
  const { key } = checkVideoKey(body.key);
  if (typeof body.uploadId === "string" && body.uploadId) {
    await env.BUCKET.resumeMultipartUpload(key, body.uploadId)
      .abort()
      .catch(() => {});
  }
  return ok();
}

/** サムネイル画像を保存する */
async function saveThumb(request: Request, env: Env, url: URL): Promise<AdminResult> {
  const { key } = checkVideoKey(url.searchParams.get("key"));
  if (!(await env.BUCKET.head(key))) throw new AdminError("動画が見つかりません", 404);
  const data = await request.arrayBuffer();
  if (data.byteLength > MAX_THUMB_BYTES || !looksLikeJpeg(data)) throw new AdminError("サムネイル画像が正しくありません");
  await env.BUCKET.put(thumbKeyOf(key), data, { httpMetadata: { contentType: "image/jpeg" } });
  return ok();
}

/** 管理者 API の振り分け（権限確認は呼び出し元で済ませておく） */
export async function handleAdminApi(request: Request, env: Env, url: URL): Promise<AdminResult> {
  const route = `${request.method} ${url.pathname.slice("/api/admin".length)}`;
  switch (route) {
    case "GET /settings":
      return ok(await readSettings(env.BUCKET));
    case "POST /folders/add":
      return addFolder(env, await readJson(request));
    case "POST /folders/delete":
      return deleteFolder(env, await readJson(request));
    case "POST /teams/add":
      return addTeam(env, await readJson(request));
    case "POST /teams/delete":
      return deleteTeam(env, await readJson(request));
    case "POST /rename":
      return rename(env, await readJson(request));
    case "POST /videos/move":
      return moveVideoTeam(env, await readJson(request));
    case "POST /videos/delete":
      return deleteVideo(env, await readJson(request));
    case "POST /upload/start":
      return uploadStart(env, await readJson(request));
    case "PUT /upload/part":
      return uploadPart(request, env, url);
    case "POST /upload/complete":
      return uploadComplete(env, await readJson(request));
    case "POST /upload/abort":
      return uploadAbort(env, await readJson(request));
    case "PUT /thumb":
      return saveThumb(request, env, url);
    default:
      throw new AdminError("Not Found", 404);
  }
}
