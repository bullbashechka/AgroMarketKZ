import type { CreateRequestInput } from "@agromarket/contracts";

const encoder = new TextEncoder();

/** Хеш только смыслового содержимого: transport id и Telegram proof намеренно исключены. */
export async function requestPayloadHash(input: CreateRequestInput): Promise<string> {
  const listingSubmission = input.source === "tab" && input.listingSubmission
    ? input.listingSubmission.type === "service"
      ? { ...input.listingSubmission, territoryCodes: [...input.listingSubmission.territoryCodes].sort() }
      : input.listingSubmission
    : null;
  const payload = {
    source: input.source,
    cardId: input.source === "card" ? input.cardId : null,
    tabType: input.source === "tab" ? input.tabType : null,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    comment: input.comment ?? null,
    listingSubmission,
  };
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(payload)));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
