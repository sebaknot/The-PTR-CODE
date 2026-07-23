import { createContext, useContext } from "react";

export type StripeReadyState = {
  stripeReady: boolean;
  stripeError: string | null;
  publishableKey: string | null;
};

export const StripeReadyContext = createContext<StripeReadyState>({
  stripeReady: false,
  stripeError: null,
  publishableKey: null,
});

export function useStripeReady(): StripeReadyState {
  return useContext(StripeReadyContext);
}
