// @ts-check
// ログイン画面の共通処理（閲覧ページ・管理ページの両方で使う）
import { clearToken, isLoggedIn, login } from "./api.js";
import { byId, errorText } from "./dom.js";

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
      message.textContent = errorText(error);
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
