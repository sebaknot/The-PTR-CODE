import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import { StripeReadyContext, type StripeReadyState } from "./StripeReadyContext";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? "";

/**
 * Web build of StripeWrapper. Web checkout goes through Stripe Checkout (a
 * redirect), so no native Stripe SDK provider is mounted here — we only fetch
 * the publishable key and expose readiness. This file is resolved by Metro on
 * web in place of StripeWrapper.tsx, keeping the native-only SDK out of the
 * web bundle.
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
  return <StripeReadyContext.Provider value={value}>{children}</StripeReadyContext.Provider>;
}

export default StripeWrapper;
