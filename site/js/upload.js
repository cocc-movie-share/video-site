// @ts-check
// 動画のアップロード処理（50MB ずつに分けて送る）とサムネイル作成
import { callApi, sendBinary } from "./api.js";

/**
 * 動画の 1 コマを JPEG 画像にする（作れない形式なら null）
 * @param {File} file
 * @returns {Promise<Blob | null>}
 */
export function createThumbnail(file) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const finish = (/** @type {Blob | null} */ blob) => {
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.onerror = () => finish(null);
    // 長さがわかったら 1 秒目（短い動画は真ん中）へ移動
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, video.duration / 2 || 0);
    };
    // 移動できたらその画面を画像にする
    video.onseeked = () => {
      const width = 480;
      const height = Math.round((width * video.videoHeight) / video.videoWidth) || 270;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return finish(null);
      context.drawImage(video, 0, 0, width, height);
      canvas.toBlob((blob) => finish(blob), "image/jpeg", 0.8);
    };
    setTimeout(() => finish(null), 15000); // 15 秒で諦める
    video.src = url;
  });
}

/**
 * 動画を 1 本アップロードする
 * @param {File} file
 * @param {string} folder 大会名
 * @param {string | null} team チーム名（なしは null）
 * @param {(percent: number) => void} onProgress 進み具合（0〜100）
 */
export async function uploadVideo(file, folder, team, onProgress) {
  const start = await callApi("/api/admin/upload/start", "admin", {
    method: "POST",
    body: JSON.stringify({ folder, team, fileName: file.name, size: file.size }),
  });
  const { key, uploadId, partSize, partCount } = start;
  const query = (/** @type {number} */ n) =>
    `?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${n}`;

  try {
    const parts = [];
    for (let n = 1; n <= partCount; n++) {
      const chunk = file.slice((n - 1) * partSize, n * partSize);
      const part = await sendBinary(`/api/admin/upload/part${query(n)}`, chunk);
      parts.push({ partNumber: part.partNumber, etag: part.etag });
      onProgress(Math.round((n / partCount) * 95));
    }
    await callApi("/api/admin/upload/complete", "admin", {
      method: "POST",
      body: JSON.stringify({ key, uploadId, parts }),
    });
  } catch (error) {
    // 途中で失敗したら、送りかけのデータを捨てる
    await callApi("/api/admin/upload/abort", "admin", {
      method: "POST",
      body: JSON.stringify({ key, uploadId }),
    }).catch(() => {});
    throw error;
  }

  // サムネイルは作れなくても動画のアップロード自体は成功扱いにする
  const thumb = await createThumbnail(file);
  if (thumb) {
    await sendBinary(`/api/admin/thumb?key=${encodeURIComponent(key)}`, thumb).catch(() => {});
  }
  onProgress(100);
}
