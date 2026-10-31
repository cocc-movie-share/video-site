// @ts-check
// 管理者ページの処理：アップロード・動画の管理・大会／チームの管理
import { callApi } from "./api.js";
import { button, byId, create, errorText, setOptions } from "./dom.js";
import { setupLogin } from "./login.js";
import { uploadVideo } from "./upload.js";

/** プルダウンで「新しく追加」を表す値 */
const NEW = "__new__";

/** 大会・チームの一覧（Worker から読み込んだもの） */
let settings = { folders: /** @type {string[]} */ ([]), teams: /** @type {string[]} */ ([]) };

/** よく使う要素 */
const uploadFolder = /** @type {HTMLSelectElement} */ (byId("upload-folder"));
const uploadTeam = /** @type {HTMLSelectElement} */ (byId("upload-team"));
const newFolder = /** @type {HTMLInputElement} */ (byId("new-folder"));
const newTeam = /** @type {HTMLInputElement} */ (byId("new-team"));
const manageFolder = /** @type {HTMLSelectElement} */ (byId("manage-folder"));

/**
 * 画面上部にメッセージを出す（空文字で消す）
 * @param {string} text
 */
function showMessage(text) {
  byId("message").textContent = text;
  if (text) window.scrollTo(0, 0);
}

/**
 * 管理者 API を POST で呼ぶ
 * @param {string} path 例："/folders/add"
 * @param {object} body
 */
function post(path, body) {
  return callApi(`/api/admin${path}`, "admin", { method: "POST", body: JSON.stringify(body) });
}

/** チームの選択肢（先頭は「チームなし」） */
function teamOptions() {
  return [{ value: "", label: "チームなし" }, ...settings.teams.map((t) => ({ value: t, label: t }))];
}

/** 大会・チームの一覧を読み込み、画面のプルダウンと一覧を作り直す */
async function loadSettings() {
  settings = await callApi("/api/admin/settings", "admin");
  const folders = settings.folders.map((f) => ({ value: f, label: f }));

  setOptions(uploadFolder, [...folders, { value: NEW, label: "＋ 新しい大会・イベントを追加" }]);
  setOptions(uploadTeam, [...teamOptions(), { value: NEW, label: "＋ 新しいチームを追加" }]);
  setOptions(manageFolder, [{ value: "", label: "選んでください" }, ...folders]);
  toggleNewInputs();

  renderNameList("folder", settings.folders);
  renderNameList("team", settings.teams);
  await loadManageVideos();
}

/** 「新しく追加」を選んだときだけ名前の入力欄を出す */
function toggleNewInputs() {
  newFolder.classList.toggle("hidden", uploadFolder.value !== NEW);
  newTeam.classList.toggle("hidden", uploadTeam.value !== NEW);
}

// ---------- 1. アップロード ----------

/**
 * プルダウンで選んだ名前を返す。「新しく追加」なら先に登録する
 * @param {"folder" | "team"} type
 * @returns {Promise<string | null>}
 */
async function selectedName(type) {
  const select = type === "folder" ? uploadFolder : uploadTeam;
  const input = type === "folder" ? newFolder : newTeam;
  if (select.value !== NEW) return select.value || null;

  const name = input.value.trim();
  if (!name) throw new Error(type === "folder" ? "新しい大会名を入力してください" : "新しいチーム名を入力してください");
  await post(type === "folder" ? "/folders/add" : "/teams/add", { name });
  input.value = "";
  return name;
}

/** 選んだ動画を 1 本ずつアップロードする */
async function startUpload() {
  const filesInput = /** @type {HTMLInputElement} */ (byId("upload-files"));
  const files = [...(filesInput.files ?? [])];
  const uploadButton = /** @type {HTMLButtonElement} */ (byId("upload-button"));
  const progress = byId("upload-progress");
  showMessage("");

  if (files.length === 0) return showMessage("動画ファイルを選んでください");

  uploadButton.disabled = true;
  try {
    const folder = await selectedName("folder");
    if (!folder) throw new Error("大会・イベントを選んでください");
    const team = await selectedName("team");
    await loadSettings();
    uploadFolder.value = folder;
    uploadTeam.value = team ?? "";
    toggleNewInputs();

    progress.replaceChildren();
    for (const file of files) {
      const item = create("li", "progress-item", `${file.name}：待機中`);
      progress.append(item);
      try {
        await uploadVideo(file, folder, team, (percent) => {
          item.textContent = `${file.name}：${percent === 100 ? "完了" : `${percent}%`}`;
        });
      } catch (error) {
        item.classList.add("is-error");
        item.textContent = `${file.name}：失敗（${errorText(error)}）`;
      }
    }
    filesInput.value = "";
    manageFolder.value = folder;
    await loadManageVideos();
  } catch (error) {
    showMessage(errorText(error));
  } finally {
    uploadButton.disabled = false;
  }
}

// ---------- 2. 動画の管理 ----------

/** 選んだ大会の動画を一覧にする（チーム変更・削除ボタン付き） */
async function loadManageVideos() {
  const list = byId("video-manage-list");
  list.replaceChildren();
  const folder = manageFolder.value;
  if (!folder) return;

  /** @type {{ videos: { key: string, folder: string, team: string | null, name: string }[] }} */
  const { videos } = await callApi("/api/videos", "admin");
  const inFolder = videos.filter((v) => v.folder === folder);
  if (inFolder.length === 0) {
    list.append(create("li", "manage-item muted", "この大会の動画はまだありません"));
    return;
  }

  for (const video of inFolder) {
    const item = create("li", "manage-item");
    const teamSelect = /** @type {HTMLSelectElement} */ (create("select", "input"));
    setOptions(teamSelect, teamOptions());
    teamSelect.value = video.team ?? "";
    teamSelect.setAttribute("aria-label", `${video.name} のチーム`);

    item.append(
      create("span", "manage-name", video.name),
      teamSelect,
      button("移動", "button-small", () => moveVideo(video.key, teamSelect.value)),
      button("削除", "button-small button-danger", () => deleteVideo(video.key, video.name)),
    );
    list.append(item);
  }
}

/**
 * 動画を別のチームへ移動する
 * @param {string} key
 * @param {string} team 空文字なら「チームなし」
 */
async function moveVideo(key, team) {
  showMessage("");
  try {
    await post("/videos/move", { key, team: team || null });
    await loadManageVideos();
  } catch (error) {
    showMessage(errorText(error));
  }
}

/**
 * 動画を削除する（確認してから）
 * @param {string} key
 * @param {string} name
 */
async function deleteVideo(key, name) {
  if (!confirm(`「${name}」を削除します。元に戻せません。よろしいですか？`)) return;
  showMessage("");
  try {
    await post("/videos/delete", { key });
    await loadManageVideos();
  } catch (error) {
    showMessage(errorText(error));
  }
}

// ---------- 3・4. 大会とチームの管理 ----------

/**
 * 大会またはチームの一覧を表示する（名前の変更・削除ボタン付き）
 * @param {"folder" | "team"} type
 * @param {string[]} names
 */
function renderNameList(type, names) {
  const list = byId(type === "folder" ? "folder-list" : "team-list");
  list.replaceChildren();
  for (const name of names) {
    const item = create("li", "manage-item");
    item.append(
      create("span", "manage-name", name),
      button("名前を変更", "button-small", () => renameItem(type, name)),
      button("削除", "button-small button-danger", () => deleteItem(type, name)),
    );
    list.append(item);
  }
}

/**
 * 名前を変更する。動画の数が多いと何回かに分けて移動するので、終わるまで繰り返す
 * @param {"folder" | "team"} type
 * @param {string} from
 */
async function renameItem(type, from) {
  const label = type === "folder" ? "大会名" : "チーム名";
  const to = prompt(`新しい${label}を入力してください`, from)?.trim();
  if (!to || to === from) return;

  showMessage(`${label}を変更しています…（動画が多いと時間がかかります。画面を閉じないでください）`);
  try {
    let moved = 0;
    for (;;) {
      const result = await post("/rename", { type, from, to });
      moved += result.moved;
      if (result.done) break;
      showMessage(`${label}を変更しています…（${moved} 本移動済み）`);
    }
    showMessage("");
    await loadSettings();
  } catch (error) {
    showMessage(`${errorText(error)}（途中まで移動した場合は、もう一度同じ名前で変更すると続きから再開します）`);
    await loadSettings();
  }
}

/**
 * 大会またはチームを削除する（動画が残っていると Worker が断る）
 * @param {"folder" | "team"} type
 * @param {string} name
 */
async function deleteItem(type, name) {
  if (!confirm(`「${name}」を削除しますか？`)) return;
  showMessage("");
  try {
    await post(type === "folder" ? "/folders/delete" : "/teams/delete", { name });
    await loadSettings();
  } catch (error) {
    showMessage(errorText(error));
  }
}

/**
 * 追加フォームを動かす
 * @param {"folder" | "team"} type
 */
function setupAddForm(type) {
  const form = byId(`${type}-form`);
  const input = /** @type {HTMLInputElement} */ (byId(`${type}-name`));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage("");
    try {
      await post(type === "folder" ? "/folders/add" : "/teams/add", { name: input.value });
      input.value = "";
      await loadSettings();
    } catch (error) {
      showMessage(errorText(error));
    }
  });
}

// ---------- 画面の準備 ----------

uploadFolder.addEventListener("change", toggleNewInputs);
uploadTeam.addEventListener("change", toggleNewInputs);
manageFolder.addEventListener("change", () => loadManageVideos().catch((e) => showMessage(errorText(e))));
byId("upload-button").addEventListener("click", startUpload);
setupAddForm("folder");
setupAddForm("team");

setupLogin("admin", () => loadSettings().catch((e) => showMessage(errorText(e))));
