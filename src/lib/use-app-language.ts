import { useEffect, useState } from "react";
import { getAppLanguage, onUiPrefsChange, type AppLanguage } from "@/lib/ui-prefs";

/** The selected interface language, re-rendering when the user switches it. */
export function useAppLanguage(): AppLanguage {
  const [lang, setLang] = useState<AppLanguage>(() => getAppLanguage());
  useEffect(() => onUiPrefsChange(() => setLang(getAppLanguage())), []);
  return lang;
}
