import {
  getPublicationPolicyIssues,
  type CardDetail,
  type CreateCardInput,
  type PublicationCandidate,
} from "@agromarket/contracts";

type PublicationContext = Pick<PublicationCandidate,
  | "categoryIsCommodity"
  | "serviceTerritoryCount"
  | "imageCount"
  | "specs"
  | "requiredSpecs"
>;

type PersistedCardPublicationSource = {
  type: PublicationCandidate["type"];
  description: string;
  price_type: PublicationCandidate["priceType"];
  price_amount: number | null;
  price_unit: string | null;
  price_reason: string | null;
  territory_code: string | null;
  ownership_form: PublicationCandidate["ownershipForm"];
  product_location: PublicationCandidate["productLocation"];
  commodity_group?: PublicationCandidate["commodityGroup"];
  volume_tonnes?: number | string | null;
  service_all_kazakhstan: boolean;
  availability: string | null;
};

type AdminListPublicationSource = PersistedCardPublicationSource & {
  image_count: number;
  service_territory_count: number;
  spec_keys: string[];
  required_specs: string[];
  is_commodity: boolean;
};

function withContext(
  source: PersistedCardPublicationSource,
  context: PublicationContext,
): PublicationCandidate {
  const parsedVolume = source.volume_tonnes == null ? null : Number(source.volume_tonnes);
  return {
    type: source.type,
    description: source.description,
    priceType: source.price_type,
    priceAmount: source.price_amount,
    priceUnit: source.price_unit,
    priceReason: source.price_reason,
    territoryCode: source.territory_code,
    ownershipForm: source.ownership_form,
    productLocation: source.product_location,
    commodityGroup: source.commodity_group,
    volumeTonnes: Number.isFinite(parsedVolume) ? parsedVolume : null,
    serviceAllKazakhstan: source.service_all_kazakhstan,
    availability: source.availability,
    ...context,
  };
}

/** Maps a create/update payload once before applying publication policy. */
export function toPublicationCandidateFromInput(
  input: CreateCardInput,
  context: Pick<PublicationContext, "categoryIsCommodity" | "requiredSpecs">,
): PublicationCandidate {
  return withContext({
    type: input.type,
    description: input.description,
    price_type: input.priceType,
    price_amount: input.priceAmount ?? null,
    price_unit: input.priceUnit ?? null,
    price_reason: input.priceReason ?? null,
    territory_code: input.territoryCode ?? null,
    ownership_form: input.ownershipForm ?? null,
    product_location: input.productLocation ?? null,
    commodity_group: input.commodityGroup ?? null,
    volume_tonnes: input.volumeTonnes,
    service_all_kazakhstan: input.serviceAllKazakhstan,
    availability: input.type === "service" ? input.availability ?? null : null,
  }, {
    ...context,
    serviceTerritoryCount: input.serviceTerritoryCodes.length,
    imageCount: input.images.length,
    specs: input.specs,
  });
}

/** Maps a persisted card row with the transactionally read publication context. */
export function toPublicationCandidateFromPersistedCard(
  card: PersistedCardPublicationSource,
  context: PublicationContext,
): PublicationCandidate {
  return withContext(card, context);
}

/** Maps the admin list projection without leaking its wide row type to other repos. */
export function toPublicationCandidateFromAdminList(
  row: AdminListPublicationSource,
): PublicationCandidate {
  return withContext(row, {
    categoryIsCommodity: row.is_commodity,
    serviceTerritoryCount: row.service_territory_count,
    imageCount: row.image_count,
    specs: row.spec_keys.map((key) => ({ key, value: "filled" })),
    requiredSpecs: row.required_specs,
  });
}

/** Maps the detail DTO independently of the admin list projection. */
export function toPublicationCandidateFromDetail(
  detail: CardDetail,
  context: Pick<PublicationContext, "categoryIsCommodity" | "requiredSpecs">,
): PublicationCandidate {
  return withContext({
    type: detail.type,
    description: detail.description,
    price_type: detail.priceType,
    price_amount: detail.priceAmount,
    price_unit: detail.priceUnit,
    price_reason: detail.priceReason,
    territory_code: detail.territory?.code ?? null,
    ownership_form: detail.ownershipForm,
    product_location: detail.productLocation,
    commodity_group: detail.commodityGroup,
    volume_tonnes: detail.volumeTonnes,
    service_all_kazakhstan: detail.serviceAllKazakhstan,
    availability: detail.availability,
  }, {
    ...context,
    serviceTerritoryCount: detail.serviceTerritories.length,
    imageCount: detail.images.length,
    specs: detail.specs,
  });
}

export function getPublicationIssueMessages(candidate: PublicationCandidate): string[] {
  return getPublicationPolicyIssues(candidate).map((issue) => issue.message);
}
