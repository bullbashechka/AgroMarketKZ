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
    await apiPost<void>("/admin/uploads/complete", { storagePath, contentType: "image/jpeg" });
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
  const imagesRef = useRef(images);
  const filesRef = useRef(new Map<string, File>());
  const blobUrlsRef = useRef(new Set<string>());
  const uploadsInFlightRef = useRef(0);

  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const update = useCallback((localId: string, patch: Partial<EditorImage>) => {
    const next = imagesRef.current.map((img) => (img.localId === localId ? { ...img, ...patch } : img));
    imagesRef.current = next;
    setImages(next);
  }, []);

  const startUpload = useCallback(
    (localId: string, file: File) => {
      filesRef.current.set(localId, file);
      void runUpload(file, (patch) => update(localId, patch)).finally(() => {
        uploadsInFlightRef.current = Math.max(0, uploadsInFlightRef.current - 1);
      });
    },
    [update]
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const incoming = Array.from(files);
      const room = Math.max(0, MAX_IMAGES - imagesRef.current.length);
      const accepted = incoming.slice(0, room);
      const created = accepted.map((file) => {
        const localId = crypto.randomUUID();
        const previewUrl = URL.createObjectURL(file);
        blobUrlsRef.current.add(previewUrl);
        return { file, localId, previewUrl };
      });
      uploadsInFlightRef.current += created.length;
      const queued: EditorImage[] = created.map(({ localId, previewUrl }) => ({
        localId,
        status: "compressing",
        previewUrl,
        storagePath: null,
        publicUrl: null
      }));
      const next = [...imagesRef.current, ...queued];
      imagesRef.current = next;
      setImages(next);
      queueMicrotask(() => created.forEach(({ localId, file }) => startUpload(localId, file)));
    },
    [startUpload]
  );

  const remove = useCallback((localId: string) => {
    const target = imagesRef.current.find((img) => img.localId === localId);
    if (target && blobUrlsRef.current.has(target.previewUrl)) {
      URL.revokeObjectURL(target.previewUrl);
      blobUrlsRef.current.delete(target.previewUrl);
    }
    filesRef.current.delete(localId);
    const next = imagesRef.current.filter((img) => img.localId !== localId);
    imagesRef.current = next;
    setImages(next);
  }, []);

  const makeCover = useCallback((localId: string) => {
    const idx = imagesRef.current.findIndex((img) => img.localId === localId);
    if (idx <= 0) return;
    const next = [...imagesRef.current];
    const [item] = next.splice(idx, 1);
    next.unshift(item!);
    imagesRef.current = next;
    setImages(next);
  }, []);

  const retry = useCallback(
    (localId: string) => {
      const file = filesRef.current.get(localId);
      if (!file) return;
      uploadsInFlightRef.current += 1;
      void runUpload(file, (patch) => update(localId, patch)).finally(() => {
        uploadsInFlightRef.current = Math.max(0, uploadsInFlightRef.current - 1);
      });
    },
    [update]
  );

  const ready = images.length >= MIN_IMAGES && images.every((img) => img.status === "done");
  const settled = images.every((img) => img.status === "done" || img.status === "error");
  const hasErrors = images.some((img) => img.status === "error");
  const isSettledNow = useCallback(
    () => uploadsInFlightRef.current === 0
      && imagesRef.current.every((img) => img.status === "done" || img.status === "error"),
    [],
  );

  return { images, addFiles, remove, makeCover, retry, ready, settled, hasErrors, isSettledNow };
}
