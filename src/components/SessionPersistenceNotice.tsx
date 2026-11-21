import { useState } from "react";
import { useSessionStore } from "@/lib/session-store";
import { useAppLanguage } from "@/lib/use-app-language";

const TEXT = {
  uz: {
    title: "Kirish faqat shu seans uchun saqlanadi",
    body: "Bu kompyuterda himoyalangan parol ombori ishlamayapti, shuning uchun BestWay kirish tokenlarini faylga yozmaydi. Ilova yopilgach, qayta kirishingiz kerak bo‘ladi.",
    dismiss: "Tushunarli",
  },
  en: {
    title: "Your sign-in lasts for this session only",
    body: "This computer has no working protected credential store, so BestWay does not write sign-in tokens to a file. You will need to sign in again after closing the app.",
    dismiss: "Got it",
  },
} as const;

/** Shown while signed in when Rust reports `memory_only` session persistence. */
export function SessionPersistenceNotice() {
  const persistence = useSessionStore((state) => state.persistence);
  const signedIn = useSessionStore((state) => state.status === "ready");
  const [dismissed, setDismissed] = useState(false);
  const t = TEXT[useAppLanguage()];
  if (persistence !== "memory_only" || !signedIn || dismissed) return null;
  return (
    <div role="status" className="mx-4 mt-3 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm">
      <div className="min-w-0 space-y-1">
        <p className="font-semibold text-amber-100">{t.title}</p>
        <p className="text-amber-100/80">{t.body}</p>
      </div>
      <button type="button" className="rounded-lg border border-amber-300/40 px-3 py-1.5 text-xs font-semibold text-amber-50 hover:bg-amber-400/10" onClick={() => setDismissed(true)}>
        {t.dismiss}
      </button>
    </div>
  );
}
