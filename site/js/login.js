// @ts-check
// 管理者ログイン画面の処理
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
 * @param {() => void} onLoggedIn ログイン後に実行する処理
 */
export async function setupLogin(onLoggedIn) {
  const form = /** @type {HTMLFormElement} */ (byId("login-form"));
  const input = /** @type {HTMLInputElement} */ (byId("password"));
  const message = byId("login-error");
  const button = /** @type {HTMLButtonElement} */ (byId("login-button"));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    button.disabled = true;
    try {
      await login(input.value);
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
    clearToken();
    showScreen(false);
  });

  // 前回のログインがまだ有効ならそのまま表示する
  const loggedIn = await isLoggedIn();
  showScreen(loggedIn);
  if (loggedIn) onLoggedIn();
}
