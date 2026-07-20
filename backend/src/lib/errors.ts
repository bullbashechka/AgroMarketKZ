/** Ошибка с HTTP-статусом — перехватывается общим `app.onError`. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}
