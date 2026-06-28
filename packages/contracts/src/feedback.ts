import { z } from "zod";
import { FEEDBACK_MESSAGE_MAX } from "./constants";
import { contactNameSchema, requiredText } from "./primitives";
import { kzPhoneSchema } from "./phone";

/** Сообщение обратной связи (ответ API). */
export const feedbackMessageSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  contactName: z.string(),
  contactPhone: z.string(),
  message: z.string(),
  createdAt: z.iso.datetime()
});

export type FeedbackMessage = z.infer<typeof feedbackMessageSchema>;

/** Отправка сообщения из формы обратной связи. */
export const createFeedbackInput = z.object({
  contactName: contactNameSchema,
  contactPhone: kzPhoneSchema,
  message: requiredText(FEEDBACK_MESSAGE_MAX, "Введите сообщение")
});

export type CreateFeedbackInput = z.infer<typeof createFeedbackInput>;
