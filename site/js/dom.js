// @ts-check
// 画面の部品を扱う共通の小さな関数

/**
 * ページの要素を id で取り出す
 * @param {string} id
 * @returns {HTMLElement}
 */
export function byId(id) {
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
export function create(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text) element.textContent = text;
  return element;
}

/**
 * ボタンを作る
 * @param {string} label
 * @param {string} className
 * @param {() => void} onClick
 */
export function button(label, className, onClick) {
  const element = /** @type {HTMLButtonElement} */ (create("button", className, label));
  element.type = "button";
  element.addEventListener("click", onClick);
  return element;
}

/**
 * プルダウンの選択肢を入れ直す
 * @param {HTMLSelectElement} select
 * @param {{ value: string, label: string }[]} options
 */
export function setOptions(select, options) {
  const current = select.value;
  select.replaceChildren(
    ...options.map(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }),
  );
  // 前に選んでいたものが残っていればそのまま選んでおく
  if (options.some((o) => o.value === current)) select.value = current;
}

/**
 * エラーから画面に出すメッセージを取り出す
 * @param {unknown} error
 */
export function errorText(error) {
  return error instanceof Error ? error.message : "エラーが発生しました";
}
