// @ts-check
// ログイン画面の共通処理（閲覧ページ・管理ページの両方で使う）
import { clearToken, isLoggedIn, login } from "./api.js";

/**
 * ページの要素を id で取り出す
 * @param {string} id
 * @returns {HTMLElement}
 */
function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`要素が見つかりません: ${id}`);
  return element;
}

/**
 * ログイン画面とログイン後の画面を切り替える
 * @param {boolean} loggedIn
 */
function showScreen(loggedIn) {
  byId("login-screen").classList.toggle("hidden", loggedIn);
  byId("main-screen").classList.toggle("hidden", !loggedIn);
}

/**
 * ログインフォームを動かす
 * @param {"viewer" | "admin"} role
 * @param {() => void} onLoggedIn ログイン後に実行する処理
 */
export async function setupLogin(role, onLoggedIn) {
  const form = /** @type {HTMLFormElement} */ (byId("login-form"));
  const input = /** @type {HTMLInputElement} */ (byId("password"));
  const message = byId("login-error");
  const button = /** @type {HTMLButtonElement} */ (byId("login-button"));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    button.disabled = true;
    try {
      await login(role, input.value);
      input.value = "";
      showScreen(true);
      onLoggedIn();
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "ログインに失敗しました";
    } finally {
      button.disabled = false;
    }
  });

  byId("logout-button").addEventListener("click", () => {
    clearToken(role);
    showScreen(false);
  });

  // 前回のログインがまだ有効ならそのまま表示する
  const loggedIn = await isLoggedIn(role);
  showScreen(loggedIn);
  if (loggedIn) onLoggedIn();
}
