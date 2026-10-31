// @ts-check
// 閲覧者ページの処理：チーム選択 → 動画一覧 → モーダル再生・保存
import { callApi } from "./api.js";
import { setupLogin } from "./login.js";

/**
 * @typedef {object} Video
 * @property {string} key
 * @property {string} folder
 * @property {string | null} team
 * @property {string} name
 * @property {string | null} thumbUrl
 */

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
 * 要素を作る（文字は textContent で入れるので HTML として解釈されない）
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 */
function create(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text) element.textContent = text;
  return element;
}

/**
 * ファイル名から拡張子を除いてタイトルにする
 * @param {string} name
 */
function titleOf(name) {
  return name.replace(/\.[^.]+$/, "");
}

/**
 * 画面を切り替える（チーム選択 / 動画一覧）
 * @param {"team" | "list"} screen
 */
function showScreen(screen) {
  byId("team-screen").classList.toggle("hidden", screen !== "team");
  byId("list-screen").classList.toggle("hidden", screen !== "list");
  window.scrollTo(0, 0);
}

/**
 * メッセージを表示する（エラーや「動画がありません」など）
 * @param {string} text
 */
function showMessage(text) {
  byId("message").textContent = text;
}

/** チーム一覧を読み込んでボタンを並べる */
async function loadTeams() {
  showMessage("");
  const list = byId("team-list");
  list.replaceChildren();
  try {
    const { teams } = await callApi("/api/teams", "viewer");
    for (const team of ["", ...teams]) {
      const button = create("button", "button team-button", team || "すべて");
      button.addEventListener("click", () => loadVideos(team));
      list.append(button);
    }
    showScreen("team");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "読み込みに失敗しました");
  }
}

/**
 * 動画一覧を読み込み、フォルダごとに並べる
 * @param {string} team 空文字なら全チーム
 */
async function loadVideos(team) {
  showMessage("読み込み中…");
  byId("current-team").textContent = team || "すべて";
  const list = byId("video-list");
  list.replaceChildren();
  showScreen("list");

  try {
    const query = team ? `?team=${encodeURIComponent(team)}` : "";
    /** @type {{ videos: Video[] }} */
    const { videos } = await callApi(`/api/videos${query}`, "viewer");
    showMessage(videos.length === 0 ? "動画はまだありません。" : "");

    // フォルダごとにまとめる（新しい動画があるフォルダが先頭）
    /** @type {Map<string, Video[]>} */
    const groups = new Map();
    for (const video of videos) {
      const group = groups.get(video.folder) ?? [];
      group.push(video);
      groups.set(video.folder, group);
    }

    for (const [folder, items] of groups) {
      list.append(create("h2", "folder-title", folder));
      const grid = create("div", "video-grid");
      for (const video of items) grid.append(videoCard(video, !team));
      list.append(grid);
    }
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "読み込みに失敗しました");
  }
}

/**
 * 動画 1 件分のカードを作る
 * @param {Video} video
 * @param {boolean} showTeam チーム名を表示するか（「すべて」を選んだときだけ表示）
 */
function videoCard(video, showTeam) {
  const card = create("div", "video-card");

  const thumbButton = create("button", "thumb-button");
  thumbButton.setAttribute("aria-label", `${titleOf(video.name)} を再生`);
  if (video.thumbUrl) {
    const img = /** @type {HTMLImageElement} */ (create("img", "thumb"));
    img.src = video.thumbUrl;
    img.alt = "";
    img.loading = "lazy";
    thumbButton.append(img);
  } else {
    thumbButton.append(create("div", "thumb thumb-empty", "▶"));
  }
  thumbButton.addEventListener("click", () => openPlayer(video));

  const row = create("div", "video-row");
  row.append(create("p", "video-name", titleOf(video.name)));
  if (showTeam && video.team) row.append(create("span", "badge", video.team));
  const saveButton = create("button", "button-small", "保存");
  saveButton.addEventListener("click", () => saveVideo(video));
  row.append(saveButton);

  card.append(thumbButton, row);
  return card;
}

/**
 * 再生・保存用の URL を Worker から受け取る（URL は 10 分で失効する）
 * @param {Video} video
 * @returns {Promise<{ playUrl: string, downloadUrl: string }>}
 */
function fetchUrls(video) {
  return callApi(`/api/play?key=${encodeURIComponent(video.key)}`, "viewer");
}

/** モーダルで現在開いている動画 */
/** @type {Video | null} */
let currentVideo = null;

/**
 * モーダルを開いて再生する
 * @param {Video} video
 */
async function openPlayer(video) {
  try {
    const { playUrl } = await fetchUrls(video);
    currentVideo = video;
    const player = /** @type {HTMLVideoElement} */ (byId("player"));
    player.src = playUrl;
    byId("modal-title").textContent = titleOf(video.name);
    byId("modal").classList.remove("hidden");
    player.play().catch(() => {}); // 自動再生できない端末では再生ボタンを押してもらう
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "再生できませんでした");
  }
}

/** モーダルを閉じて再生を止める */
function closePlayer() {
  const player = /** @type {HTMLVideoElement} */ (byId("player"));
  player.pause();
  player.removeAttribute("src");
  player.load();
  byId("modal").classList.add("hidden");
  currentVideo = null;
}

/**
 * 動画を端末に保存する
 * @param {Video} video
 */
async function saveVideo(video) {
  try {
    const { downloadUrl } = await fetchUrls(video);
    window.location.href = downloadUrl; // 保存用 URL はページを移動せずにダウンロードが始まる
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "保存できませんでした");
  }
}

// ボタンの動きを登録
byId("back-button").addEventListener("click", () => showScreen("team"));
byId("close-button").addEventListener("click", closePlayer);
byId("modal-save-button").addEventListener("click", () => {
  if (currentVideo) saveVideo(currentVideo);
});
byId("modal").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closePlayer(); // 黒い背景を押しても閉じる
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePlayer();
});

setupLogin("viewer", loadTeams);
