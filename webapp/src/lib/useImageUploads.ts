import { MAX_IMAGES, MIN_IMAGES } from "@agromarket/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost } from "./api";
import { ImageDecodeError, compressImage } from "./imageCompression";

export type ImageStatus = "compressing" | "uploading" | "done" | "error";

export interface EditorImage {
  localId: string;
  status: ImageStatus;
  previewUrl: string;
  storagePath: string | null;
  publicUrl: string | null;
  errorMessage?: string;
}

/** Уже загруженное фото (для восстановления из черновика или редактирования существующей карточки). */
export interface DraftImage {
  storagePath: string;
  publicUrl: string;
}

interface UploadUrlResponse {
  storagePath: string;
  uploadUrl: string;
  token: string;
}

/** Публичный URL из signed upload URL — тот же вывод, что и `publicImageUrl` на backend, без похода на сервер. */
export function publicUrlFromUploadUrl(uploadUrl: string): string {
  return uploadUrl.replace("/object/upload/sign/", "/object/public/").split("?")[0]!;
}

async function runUpload(file: File, update: (patch: Partial<EditorImage>) => void): Promise<void> {
  update({ status: "compressing", errorMessage: undefined });
  try {
    const blob = await compressImage(file);
    update({ status: "uploading" });
    const { storagePath, uploadUrl } = await apiPost<UploadUrlResponse>("/admin/uploads", {
      contentType: "image/jpeg"
    });
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: blob
    });
    if (!response.ok) throw new Error("upload failed");
    update({ status: "done", storagePath, publicUrl: publicUrlFromUploadUrl(uploadUrl) });
  } catch (err) {
    update({
      status: "error",
      errorMessage: err instanceof ImageDecodeError ? err.message : "Не удалось загрузить фото"
    });
  }
}

/**
 * Состояние фото в редакторе карточки: компрессия → загрузка → готово/ошибка. Первый элемент
 * массива — обложка карточки (порядок не редактируется, только «Сделать обложкой»).
 */
export function useImageUploads(initial: DraftImage[] = []) {
  const [images, setImages] = useState<EditorImage[]>(() =>
    initial.map((img) => ({
      localId: crypto.randomUUID(),
      status: "done" as const,
      previewUrl: img.publicUrl,
      storagePath: img.storagePath,
      publicUrl: img.publicUrl
    }))
  );
  const filesRef = useRef(new Map<string, File>());
  const blobUrlsRef = useRef(new Set<string>());

  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const update = useCallback((localId: string, patch: Partial<EditorImage>) => {
    setImages((prev) => prev.map((img) => (img.localId === localId ? { ...img, ...patch } : img)));
  }, []);

  const startUpload = useCallback(
    (localId: string, file: File) => {
      filesRef.current.set(localId, file);
      void runUpload(file, (patch) => update(localId, patch));
    },
    [update]
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const incoming = Array.from(files);
      setImages((prev) => {
        const room = Math.max(0, MAX_IMAGES - prev.length);
        const accepted = incoming.slice(0, room);
        const created = accepted.map((file) => {
          const localId = crypto.randomUUID();
          const previewUrl = URL.createObjectURL(file);
          blobUrlsRef.current.add(previewUrl);
          return { file, localId, previewUrl };
        });
        // Запускаем загрузку после коммита состояния, чтобы update() не гнался за setImages.
        queueMicrotask(() => created.forEach(({ localId, file }) => startUpload(localId, file)));
        const next: EditorImage[] = created.map(({ localId, previewUrl }) => ({
          localId,
          status: "compressing",
          previewUrl,
          storagePath: null,
          publicUrl: null
        }));
        return [...prev, ...next];
      });
    },
    [startUpload]
  );

  const remove = useCallback((localId: string) => {
    setImages((prev) => {
      const target = prev.find((img) => img.localId === localId);
      if (target && blobUrlsRef.current.has(target.previewUrl)) {
        URL.revokeObjectURL(target.previewUrl);
        blobUrlsRef.current.delete(target.previewUrl);
      }
      filesRef.current.delete(localId);
      return prev.filter((img) => img.localId !== localId);
    });
  }, []);

  const makeCover = useCallback((localId: string) => {
    setImages((prev) => {
      const idx = prev.findIndex((img) => img.localId === localId);
      if (idx <= 0) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.unshift(item!);
      return copy;
    });
  }, []);

  const retry = useCallback(
    (localId: string) => {
      const file = filesRef.current.get(localId);
      if (!file) return;
      void runUpload(file, (patch) => update(localId, patch));
    },
    [update]
  );

  const ready = images.length >= MIN_IMAGES && images.every((img) => img.status === "done");

  return { images, addFiles, remove, makeCover, retry, ready };
}
