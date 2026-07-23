import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { StripeProvider } from "@stripe/stripe-react-native";
import { StripeReadyContext, type StripeReadyState } from "./StripeReadyContext";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? "";

/**
 * Fetches the Stripe publishable key from the API and exposes readiness through
 * StripeReadyContext. On native it also mounts the Stripe SDK provider so the
 * payment sheet can present. Web payment goes through Stripe Checkout, which
 * needs no provider here.
 */
export function StripeWrapper({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<StripeReadyState>({
    stripeReady: false,
    stripeError: null,
    publishableKey: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`https://${DOMAIN}/api/payments/config`);
        if (!res.ok) throw new Error(`Config request failed (${res.status})`);
        const { publishableKey } = (await res.json()) as { publishableKey?: string };
        if (cancelled) return;
        if (!publishableKey) throw new Error("Missing publishable key");
        setState({ stripeReady: true, stripeError: null, publishableKey });
      } catch (err) {
        if (cancelled) return;
        setState({
          stripeReady: false,
          stripeError: err instanceof Error ? err.message : "Stripe unavailable",
          publishableKey: null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => state, [state]);

  const content = <StripeReadyContext.Provider value={value}>{children}</StripeReadyContext.Provider>;

  // Native SDK provider; web uses Checkout redirect so no provider is required.
  if (Platform.OS !== "web" && value.publishableKey) {
    return (
      <StripeProvider publishableKey={value.publishableKey} merchantIdentifier="merchant.com.porter.deliveryapp">
        {content}
      </StripeProvider>
    );
  }

  return content;
}

export default StripeWrapper;
