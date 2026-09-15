export type Theme = "light" | "dark";

export const STORAGE_KEY = "swim-theme";
export const CHANGE_EVENT = "swim-theme-change";

/**
 * Runs before the page paints, so a dark visitor never sees a light flash.
 * A choice made with the toggle wins over the system setting.
 */
export const THEME_SCRIPT = `(() => {
  let theme = null;
  try { theme = localStorage.getItem("${STORAGE_KEY}"); } catch {}
  if (theme !== "light" && theme !== "dark") {
    theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.dataset.theme = theme;
})();`;
