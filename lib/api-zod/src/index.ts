export * from "./generated/api";
export * from "./generated/types";

// These names are emitted by both ./generated/api (runtime zod schemas) and
// ./generated/types (inferred TS types). Explicitly re-export the schemas so the
// ambiguity is resolved in favour of the values the server validates with.
export {
  AcceptDeliveryBody,
  CreateDeliveryBody,
  CreateUserBody,
  ListDeliveriesResponse,
  UpdateDeliveryStatusBody,
  UpdateUserBody,
} from "./generated/api";
