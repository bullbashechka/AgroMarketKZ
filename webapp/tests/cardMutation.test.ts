import { describe, expect, test } from "bun:test";
import type { AdminCardDetail } from "@agromarket/contracts";
import { PublishAfterSaveError } from "../src/lib/cardMutation";

test("PublishAfterSaveError keeps the committed card for save → publish recovery", () => {
  const saved = {} as AdminCardDetail;
  const publishError = new Error("publish rejected");
  const error = new PublishAfterSaveError(saved, publishError);

  expect(error.saved).toBe(saved);
  expect(error.publishError).toBe(publishError);
});
