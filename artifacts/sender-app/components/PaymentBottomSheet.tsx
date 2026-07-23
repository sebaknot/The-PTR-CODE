import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useStripe } from "@stripe/stripe-react-native";
import { useColors } from "@/context/ThemeContext";
import { useUser } from "@/context/UserContext";
import { useStripeReady } from "./StripeReadyContext";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? "";

export type PaymentDeliveryData = {
  packageSize: string;
  packageDescription: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  notes?: string;
  deliveryType?: string;
  porterBoxId?: string;
  senderPhotoUrl?: string;
};

export function PaymentBottomSheet({
  visible,
  onClose,
  onCancelled,
  onSuccess,
  estimatedPrice,
  distanceKm,
  userId,
  deliveryData,
  confirmLabel,
}: {
  visible: boolean;
  onClose: () => void;
  onCancelled?: () => void;
  onSuccess: (deliveryId: string) => void;
  estimatedPrice: number;
  distanceKm: number;
  userId: string;
  deliveryData: PaymentDeliveryData;
  confirmLabel?: string;
}): React.JSX.Element {
  const C = useColors();
  const { token } = useUser();
  const { stripeReady, stripeError } = useStripeReady();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  async function payNative(): Promise<void> {
    // 1. Create a PaymentIntent on the server (price is computed server-side).
    const intentRes = await fetch(`https://${DOMAIN}/api/payments/intent`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ deliveryData }),
    });
    if (!intentRes.ok) throw new Error("Could not start payment");
    const { clientSecret, paymentIntentId } = (await intentRes.json()) as {
      clientSecret: string;
      paymentIntentId: string;
    };

    // 2. Present Stripe's native payment sheet.
    const init = await initPaymentSheet({
      merchantDisplayName: "Porter",
      paymentIntentClientSecret: clientSecret,
      applePay: { merchantCountryCode: "US" },
      allowsDelayedPaymentMethods: false,
    });
    if (init.error) throw new Error(init.error.message);

    const present = await presentPaymentSheet();
    if (present.error) {
      // User cancelled or payment failed — not a hard error.
      onCancelled?.();
      return;
    }

    // 3. Confirm server-side and create the delivery from verified metadata.
    const completeRes = await fetch(`https://${DOMAIN}/api/payments/complete-intent`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ paymentIntentId }),
    });
    if (!completeRes.ok) throw new Error("Payment could not be confirmed");
    const { delivery } = (await completeRes.json()) as { delivery: { id: string } };
    onSuccess(delivery.id);
  }

  async function payWeb(): Promise<void> {
    const res = await fetch(`https://${DOMAIN}/api/payments/checkout-session`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ deliveryData }),
    });
    if (!res.ok) throw new Error("Could not start checkout");
    const { url } = (await res.json()) as { url?: string };
    if (url && typeof window !== "undefined") {
      window.location.assign(url);
      return;
    }
    throw new Error("Checkout is unavailable on this platform build");
  }

  const handlePay = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (Platform.OS === "web") await payWeb();
      else await payNative();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || (Platform.OS !== "web" && !stripeReady);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onClose} />
        <View style={[styles.sheet, { backgroundColor: C.surface }]}>
          <View style={[styles.grabber, { backgroundColor: C.border }]} />

          <Text style={[styles.title, { color: C.text }]}>Confirm & pay</Text>

          <View style={[styles.summary, { borderColor: C.border, backgroundColor: C.surfaceSecondary }]}>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: C.textSecondary }]}>Distance</Text>
              <Text style={[styles.summaryValue, { color: C.text }]}>
                {(distanceKm * 0.621371).toFixed(1)} mi
              </Text>
            </View>
            <View style={[styles.divider, { backgroundColor: C.border }]} />
            <View style={styles.summaryRow}>
              <Text style={[styles.totalLabel, { color: C.text }]}>Total</Text>
              <Text style={[styles.total, { color: C.text }]}>${estimatedPrice.toFixed(2)}</Text>
            </View>
          </View>

          {error || stripeError ? (
            <Text style={[styles.error, { color: C.error }]}>{error ?? stripeError}</Text>
          ) : null}

          <Pressable
            onPress={handlePay}
            disabled={disabled}
            style={({ pressed }) => [
              styles.payButton,
              { backgroundColor: C.primary, opacity: disabled ? 0.5 : pressed ? 0.88 : 1 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Feather name="lock" size={15} color="#fff" />
                <Text style={styles.payText}>{confirmLabel ?? "Pay & request pickup"}</Text>
              </>
            )}
          </Pressable>

          <Text style={[styles.secure, { color: C.textTertiary }]}>
            Payments are processed securely by Stripe.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 40, gap: 16 },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: "center" },
  title: { fontSize: 20, fontWeight: "700" },
  summary: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryLabel: { fontSize: 14 },
  summaryValue: { fontSize: 14, fontWeight: "600" },
  divider: { height: 1 },
  totalLabel: { fontSize: 16, fontWeight: "700" },
  total: { fontSize: 22, fontWeight: "800" },
  error: { fontSize: 13, fontWeight: "500" },
  payButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, paddingVertical: 17 },
  payText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secure: { fontSize: 12, textAlign: "center" },
});

export default PaymentBottomSheet;
