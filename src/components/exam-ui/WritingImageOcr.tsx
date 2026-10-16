import { useCallback, useEffect, useRef, useState } from "react";
import { uploadMockWritingOcr } from "../../lib/mocks";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const ALLOWED_EXTENSIONS = /\.(jpe?g|png|webp)$/i;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB per image
const DEFAULT_MAX_PAGES = 5;

export interface WritingOcrPageItem {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
}

export interface WritingImageOcrProps {
  attemptId?: string;
  questionId: string;
  currentText?: string;
  onExtractedText: (ocrText: string, mode: "replace" | "append") => void;
  maxPages?: number;
}

export default function WritingImageOcr({
  attemptId,
  questionId,
  currentText = "",
  onExtractedText,
  maxPages = DEFAULT_MAX_PAGES,
}: WritingImageOcrProps) {
  const [pages, setPages] = useState<WritingOcrPageItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [replacingIndex, setReplacingIndex] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  useEffect(() => {
    return () => {
      for (const p of pagesRef.current) {
        if (p.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(p.previewUrl);
        }
      }
    };
  }, []);

  const validateFile = useCallback((file: File): string | null => {
    const validType =
      ALLOWED_MIME_TYPES.has(file.type.toLowerCase()) ||
      ALLOWED_EXTENSIONS.test(file.name);
    if (!validType) {
      return `"${file.name}" formati qo'llab-quvvatlanmaydi. Faqat JPG, PNG yoki WEBP yuklang.`;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      return `"${file.name}" hajmi ${mb} MB — maksimal ruxsat etilgan hajm 10 MB.`;
    }
    return null;
  }, []);

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      setErrorMessage(null);
      const incoming = Array.from(fileList);
      if (incoming.length === 0) return;

      const validItems: WritingOcrPageItem[] = [];
      for (const file of incoming) {
        const err = validateFile(file);
        if (err) {
          setErrorMessage(err);
          continue;
        }
        validItems.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          previewUrl: URL.createObjectURL(file),
          name: file.name,
        });
      }

      if (validItems.length === 0) return;

      setPages((prev) => {
        const remaining = maxPages - prev.length;
        if (remaining <= 0) {
          setErrorMessage(`Maksimal ${maxPages} ta sahifa yuklash mumkin.`);
          for (const item of validItems) URL.revokeObjectURL(item.previewUrl);
          return prev;
        }
        if (validItems.length > remaining) {
          setErrorMessage(`Maksimal ${maxPages} ta sahifa: dastlabki ${remaining} tasi qo'shildi.`);
          for (const extra of validItems.slice(remaining)) {
            URL.revokeObjectURL(extra.previewUrl);
          }
        }
        return [...prev, ...validItems.slice(0, remaining)];
      });
    },
    [maxPages, validateFile],
  );

  const handleReplacePage = useCallback(
    (index: number, file: File) => {
      setErrorMessage(null);
      const err = validateFile(file);
      if (err) {
        setErrorMessage(err);
        return;
      }
      const nextItem: WritingOcrPageItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        name: file.name,
      };
      setPages((prev) => {
        const copy = [...prev];
        const old = copy[index];
        if (old?.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(old.previewUrl);
        }
        copy[index] = nextItem;
        return copy;
      });
    },
    [validateFile],
  );

  const handleRemovePage = useCallback((index: number) => {
    setPages((prev) => {
      const target = prev[index];
      if (target?.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((_, idx) => idx !== index);
    });
  }, []);

  const handleExtractOcr = async (mode: "replace" | "append" = "replace") => {
    if (pages.length === 0) {
      setErrorMessage("Avval kamida bitta qo'lyozma rasmini yuklang.");
      return;
    }
    if (!attemptId) {
      setErrorMessage("Uriniw (attempt) identifikatori topilmadi.");
      return;
    }

    setIsExtracting(true);
    setErrorMessage(null);
    setStatusMessage("Qo'lyozma o'qilmoqda...");

    try {
      const result = await uploadMockWritingOcr(
        attemptId,
        questionId,
        pages.map((p) => p.file),
      );
      const extracted = (result?.ocrText ?? "").trim();
      if (!extracted) {
        setErrorMessage("Rasmdan matn aniqlanmadi. Iltimos, aniqroq rasm yuklang.");
        setStatusMessage(null);
        return;
      }
      const wordCount = extracted.split(/\s+/).filter(Boolean).length;
      onExtractedText(extracted, mode);
      setStatusMessage(`OCR yakunlandi: ${wordCount} ta so'z ajratib olindi.`);
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string"
          ? (err as { message: string }).message
          : "OCR matnni ajratib olishda xatolik yuz berdi.";
      setErrorMessage(msg);
      setStatusMessage(null);
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <div
      className="mb-3 rounded-lg border border-slate-300 bg-slate-50/90 p-3 text-slate-900"
      onDragStart={(e) => e.stopPropagation()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && replacingIndex !== null) {
            handleReplacePage(replacingIndex, file);
          }
          setReplacingIndex(null);
          e.target.value = "";
        }}
      />

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-slate-900">
            ✍️ Qo&apos;lyozma rasmni yuklash va OCR (AI matnga aylantirish)
          </p>
          <p className="text-[11px] text-slate-600">
            JPG, PNG, WEBP (max 10MB, {maxPages} betgacha) — Kamera yoki fayl orqali
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={isExtracting || pages.length >= maxPages}
            onClick={() => cameraInputRef.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-blue-400 bg-white px-2.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            📷 Rasmga olish yoki yuklash
          </button>
          <button
            type="button"
            disabled={isExtracting || pages.length >= maxPages}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            📁 Fayl tanlash
          </button>
        </div>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);
          if (e.dataTransfer?.files?.length) {
            addFiles(e.dataTransfer.files);
          }
        }}
        onClick={() => {
          if (!isExtracting && pages.length < maxPages) {
            fileInputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !isExtracting && pages.length < maxPages) {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className={`cursor-pointer rounded-md border-2 border-dashed px-3 py-2.5 text-center text-xs transition-colors ${
          isDragging
            ? "border-blue-600 bg-blue-50"
            : "border-slate-300 bg-white hover:border-blue-400"
        }`}
      >
        <p className="font-medium text-slate-700">
          Qo&apos;lyozma rasmlarini shu yerga tashlang yoki bosib tanlang ({pages.length}/{maxPages} bet)
        </p>
      </div>

      {errorMessage && (
        <p role="alert" className="mt-2 rounded bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">
          {errorMessage}
        </p>
      )}

      {pages.length > 0 && (
        <div className="mt-2.5 space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
            {pages.map((page, idx) => (
              <div
                key={page.id}
                className="overflow-hidden rounded border border-slate-200 bg-white shadow-2xs"
              >
                <div className="relative aspect-4/3 w-full bg-slate-100">
                  <img
                    src={page.previewUrl}
                    alt={`${idx + 1}-bet`}
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute top-1 left-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {idx + 1}-bet
                  </span>
                  <button
                    type="button"
                    disabled={isExtracting}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemovePage(idx);
                    }}
                    className="absolute top-1 right-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white hover:bg-red-700"
                    title="O'chirish"
                  >
                    ×
                  </button>
                </div>
                <div className="flex items-center justify-between px-1.5 py-1 text-[10px]">
                  <span className="font-semibold text-slate-700">{idx + 1}-bet</span>
                  <button
                    type="button"
                    disabled={isExtracting}
                    onClick={(e) => {
                      e.stopPropagation();
                      setReplacingIndex(idx);
                      replaceInputRef.current?.click();
                    }}
                    className="font-semibold text-blue-700 hover:underline"
                  >
                    Almashtirish
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isExtracting}
                onClick={() => void handleExtractOcr("replace")}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {isExtracting ? "⏳ Qo'lyozma o'qilmoqda..." : "🔍 Matnni ajratib olish (OCR)"}
              </button>

              {currentText.trim().length > 0 && !isExtracting && (
                <button
                  type="button"
                  onClick={() => void handleExtractOcr("append")}
                  className="inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  Davomiga qo&apos;shish
                </button>
              )}
            </div>

            {statusMessage && (
              <span className="text-[11px] font-medium text-emerald-700">{statusMessage}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
