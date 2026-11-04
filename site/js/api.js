// @ts-check
// Worker（API）との通信と、管理者のログイン状態の保存をまとめたファイル
// 閲覧はログイン不要。トークンを使うのは管理者だけ。
import { API_BASE_URL } from "./config.js";

/** 管理者トークンの保存場所（sessionStorage：タブを閉じるとログアウト） */
const TOKEN_KEY = "token-admin";

/**
 * 保存している管理者トークンを取り出す
 * @returns {string | null}
 */
function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

/** 管理者トークンを削除する（ログアウト） */
export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

/**
 * API を呼び出す共通処理。失敗したらエラーメッセージ付きで例外を投げる
 * 管理者としてログインしていればトークンを付けて送る。
 * @param {string} path 例："/api/videos"
 * @param {RequestInit} [options]
 */
export async function callApi(path, options = {}) {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body) headers.set("Content-Type", "application/json");

  const response = await fetch(API_BASE_URL + path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) clearToken();
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
    headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/octet-stream" },
    body: data,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "送信に失敗しました");
  return result;
}

/**
 * 管理者としてログインしてトークンを保存する
 * @param {string} password
 */
export async function login(password) {
  const data = await callApi("/api/login", { method: "POST", body: JSON.stringify({ password }) });
  sessionStorage.setItem(TOKEN_KEY, data.token);
}

/**
 * 保存している管理者トークンがまだ有効か確認する
 * @returns {Promise<boolean>}
 */
export async function isLoggedIn() {
  if (!getToken()) return false;
  try {
    await callApi("/api/me");
    return true;
  } catch {
    return false;
  }
}
