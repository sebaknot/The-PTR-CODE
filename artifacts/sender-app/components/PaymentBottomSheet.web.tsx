import React, { useState } from "react";
import { View, Text, Pressable, Modal, StyleSheet, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
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

/**
 * Web build of the payment sheet. Uses Stripe Checkout (a hosted redirect)
 * instead of the native payment sheet, so the native Stripe SDK never enters
 * the web bundle. Metro resolves this over PaymentBottomSheet.tsx on web.
 */
export function PaymentBottomSheet({
  visible,
  onClose,
  onSuccess,
  estimatedPrice,
  distanceKm,
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
  const { stripeError } = useStripeReady();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePay = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`https://${DOMAIN}/api/payments/checkout-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ deliveryData }),
      });
      if (!res.ok) throw new Error("Could not start checkout");
      const data = (await res.json()) as { url?: string; delivery?: { id: string } };
      if (data.url && typeof window !== "undefined") {
        window.location.assign(data.url);
        return;
      }
      if (data.delivery) {
        onSuccess(data.delivery.id);
        return;
      }
      throw new Error("Checkout is unavailable on this build");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  };

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
            disabled={busy}
            style={({ pressed }) => [
              styles.payButton,
              { backgroundColor: C.primary, opacity: busy ? 0.5 : pressed ? 0.88 : 1 },
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
