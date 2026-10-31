// @ts-check
// Worker（API）との通信とログイン状態の保存をまとめたファイル
import { API_BASE_URL } from "./config.js";

/**
 * トークンの保存先
 * - 閲覧者：localStorage（ブラウザを閉じても 7 日間ログインしたまま）
 * - 管理者：sessionStorage（タブを閉じるとログアウト）
 * @param {"viewer" | "admin"} role
 */
function storageFor(role) {
  return role === "admin" ? sessionStorage : localStorage;
}

/**
 * 保存しているトークンを取り出す
 * @param {"viewer" | "admin"} role
 * @returns {string | null}
 */
export function getToken(role) {
  return storageFor(role).getItem(`token-${role}`);
}

/**
 * トークンを削除する（ログアウト）
 * @param {"viewer" | "admin"} role
 */
export function clearToken(role) {
  storageFor(role).removeItem(`token-${role}`);
}

/**
 * API を呼び出す共通処理。失敗したらエラーメッセージ付きで例外を投げる
 * @param {string} path 例："/api/me"
 * @param {"viewer" | "admin"} role どちらのトークンを付けるか
 * @param {RequestInit} [options]
 */
export async function callApi(path, role, options = {}) {
  const headers = new Headers(options.headers);
  const token = getToken(role);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body) headers.set("Content-Type", "application/json");

  const response = await fetch(API_BASE_URL + path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) clearToken(role);
    throw new Error(data.error ?? "通信に失敗しました");
  }
  return data;
}

/**
 * ファイルのデータ（動画の一部やサムネイル）を管理者として送る
 * @param {string} path 例："/api/admin/thumb?key=..."
 * @param {Blob} data
 */
export async function sendBinary(path, data) {
  const response = await fetch(API_BASE_URL + path, {
    method: "PUT",
    headers: { Authorization: `Bearer ${getToken("admin")}`, "Content-Type": "application/octet-stream" },
    body: data,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "送信に失敗しました");
  return result;
}

/**
 * ログインしてトークンを保存する
 * @param {"viewer" | "admin"} role
 * @param {string} password
 */
export async function login(role, password) {
  const data = await callApi("/api/login", role, {
    method: "POST",
    body: JSON.stringify({ role, password }),
  });
  storageFor(role).setItem(`token-${role}`, data.token);
}

/**
 * 保存しているトークンがまだ有効か確認する
 * @param {"viewer" | "admin"} role
 * @returns {Promise<boolean>}
 */
export async function isLoggedIn(role) {
  if (!getToken(role)) return false;
  try {
    await callApi("/api/me", role);
    return true;
  } catch {
    return false;
  }
}
