import { createFeedbackInput, feedbackMessageSchema } from "@agromarket/contracts";
import { Hono } from "hono";
import { getEnv, type HonoEnv } from "../env";
import { runInBackground } from "../lib/background";
import { dispatchNotificationForEntity } from "../lib/notificationOutbox";
import { requireAuth } from "../middleware/auth";
import { requireRegistered } from "../middleware/registered";
import { createFeedback, toFeedbackMessage } from "../repos/feedback";

export const feedbackRoutes = new Hono<HonoEnv>();

feedbackRoutes.use("*", requireAuth, requireRegistered);

/** Приём сообщения из формы обратной связи. Точный атомарный антиспам-лимит (см. repos/feedback.ts). */
feedbackRoutes.post("/", async (c) => {
  const env = getEnv(c);
  const { userId } = c.get("auth");
  const input = createFeedbackInput.parse(await c.req.json());

  const row = await createFeedback(env, userId, input);
  runInBackground(c, dispatchNotificationForEntity(env, "feedback", row.id));

  return c.json(feedbackMessageSchema.parse(toFeedbackMessage(row)), 201);
});
