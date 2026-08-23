import { describe, expect, test } from "bun:test";
import { createRequestInput, createCardInput } from "@agromarket/contracts";

const contact = {
  clientRequestId: "11111111-1111-4111-8111-111111111111",
  contactName: "Айбек",
  contactPhone: "+77011234567"
};

describe("структурированные заявки", () => {
  test("отклоняет несовпадающий тип вкладки и предложения", () => {
    const parsed = createRequestInput.safeParse({
      ...contact,
      source: "tab",
      tabType: "product",
      listingSubmission: {
        type: "service",
        categoryId: "11111111-1111-4111-8111-111111111112",
        allKazakhstan: true,
        territoryCodes: []
      }
    });
    expect(parsed.success).toBeFalse();
  });

  test("отклоняет повтор одного региона услуги", () => {
    const parsed = createCardInput.safeParse({
      type: "service",
      categoryId: "11111111-1111-4111-8111-111111111112",
      title: "Агроконсультация",
      serviceAllKazakhstan: false,
      serviceTerritoryCodes: ["almaty_region", "almaty_region"]
    });
    expect(parsed.success).toBeFalse();
  });
});
