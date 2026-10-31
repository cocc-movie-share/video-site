// @ts-check
// 管理者ページの処理
import { setupLogin } from "./login.js";

/** ログイン後の処理（アップロード・フォルダ／チーム管理は次の機能で追加する） */
function onLoggedIn() {}

setupLogin("admin", onLoggedIn);
