import { describe, expect, test } from "bun:test";
import { cardConstraintError } from "../src/repos/adminCatalog";

function postgresError(code: string, constraint: string) {
  return Object.assign(new Error(`${code} ${constraint}`), { code, constraint });
}

describe("cardConstraintError", () => {
  test.each([
    "cards_published_price_complete",
    "cards_title_not_blank",
    "card_images_storage_path_not_blank",
    "card_specs_value_not_blank",
  ])("maps the known check constraint %s to a user-facing 400", (constraint) => {
    expect(cardConstraintError(postgresError("23514", constraint))).toMatchObject({
      status: 400,
      details: { code: "CARD_CONSTRAINT_VIOLATION" },
    });
  });

  test("does not downgrade an unknown check constraint", () => {
    expect(cardConstraintError(postgresError("23514", "cards_future_rule"))).toBeUndefined();
    expect(cardConstraintError(postgresError("23514", "requests_listing_submission_shape"))).toBeUndefined();
  });
});
