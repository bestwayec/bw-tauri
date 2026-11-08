/**
 * App-wide display preferences that are read by real UI: the interface
 * language (update toast, error cards) and the exam runner's colour theme.
 *
 * The desktop shell itself is dark-only, so the runner defaults to its
 * "app" palette (the same dark background) to match it. A student who
 * switches the runner to another contrast keeps that choice across sections
 * and restarts.
 */

export type AppLanguage = "uz" | "en";
export type ExamTheme = "app" | "standard" | "dark" | "grey";

/** The shell's only theme. Window/body backgrounds and the runner follow it. */
export const APP_THEME = "dark" as const;
/** Same value as `--bg` in styles.css and `backgroundColor` in tauri.conf.json. */
export const APP_BACKGROUND = "#0B0F17";

const LANGUAGE_KEY = "bestway.language";
const EXAM_THEME_KEY = "bestway.examTheme";
const CHANGE_EVENT = "bestway:ui-prefs";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — preference lasts for this session only */
  }
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* non-DOM test environment */
  }
}

/** Selected interface language; Uzbek unless the student picked English. */
export function getAppLanguage(): AppLanguage {
  return read(LANGUAGE_KEY) === "en" ? "en" : "uz";
}

export function setAppLanguage(lang: AppLanguage): void {
  write(LANGUAGE_KEY, lang);
}

/** Runner theme: the stored choice, otherwise the shell-matching "app" palette. */
export function getExamTheme(): ExamTheme {
  const raw = read(EXAM_THEME_KEY);
  return raw === "app" || raw === "standard" || raw === "grey" || raw === "dark" ? raw : "app";
}

export function setExamTheme(theme: ExamTheme): void {
  write(EXAM_THEME_KEY, theme);
}

/** Subscribe to preference changes made anywhere in the app. */
export function onUiPrefsChange(cb: () => void): () => void {
  try {
    window.addEventListener(CHANGE_EVENT, cb);
    window.addEventListener("storage", cb);
    return () => {
      window.removeEventListener(CHANGE_EVENT, cb);
      window.removeEventListener("storage", cb);
    };
  } catch {
    return () => undefined;
  }
}
