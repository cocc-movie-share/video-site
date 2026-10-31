// @ts-check
// 閲覧者ページの処理
import { setupLogin } from "./login.js";

/** ログイン後の処理（チーム選択・動画一覧は次の機能で追加する） */
function onLoggedIn() {}

setupLogin("viewer", onLoggedIn);
