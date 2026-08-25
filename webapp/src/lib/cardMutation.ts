import type { AdminCardDetail } from "@agromarket/contracts";

/** Сохраняет результат первого шага, если второй шаг publish завершился ошибкой. */
export class PublishAfterSaveError extends Error {
  constructor(
    public readonly saved: AdminCardDetail,
    public readonly publishError: unknown,
  ) {
    super("Публикация не завершилась после сохранения карточки");
    this.name = "PublishAfterSaveError";
  }
}
