import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useColors } from "@/context/ThemeContext";

export type DeliveryCardModel = {
  id: string;
  status: string;
  deliveryType?: string | null;
  packageSize?: string | null;
  packageDescription?: string | null;
  pickupAddress: string;
  dropoffAddress: string;
  estimatedPrice?: number | null;
  createdAt?: string | null;
  sender?: { name?: string | null } | null;
  courier?: { name?: string | null } | null;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Finding porter",
  accepted: "Porter assigned",
  picked_up: "In transit",
  in_box: "In Porter Box",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

function statusTone(status: string, C: ReturnType<typeof useColors>): string {
  if (status === "delivered") return C.success;
  if (status === "cancelled") return C.error;
  if (status === "pending") return C.warning;
  return C.primary;
}

export function DeliveryCard({
  delivery,
  role,
  onPress,
}: {
  delivery: DeliveryCardModel;
  role: "sender" | "courier";
  onPress?: () => void;
}): React.JSX.Element {
  const C = useColors();
  const tone = statusTone(delivery.status, C);
  const price =
    typeof delivery.estimatedPrice === "number"
      ? `$${delivery.estimatedPrice.toFixed(2)}`
      : "—";

  const handlePress = (): void => {
    if (onPress) return onPress();
    if (role === "sender") router.push(`/delivery/${delivery.id}`);
    else router.push(`/tracking/${delivery.id}`);
  };

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: C.surface,
          borderColor: C.border,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={[styles.statusPill, { backgroundColor: tone + "1A" }]}>
          <View style={[styles.dot, { backgroundColor: tone }]} />
          <Text style={[styles.statusText, { color: tone }]}>
            {STATUS_LABEL[delivery.status] ?? delivery.status}
          </Text>
        </View>
        <Text style={[styles.price, { color: C.text }]}>{price}</Text>
      </View>

      <View style={styles.route}>
        <View style={styles.routeLine}>
          <View style={[styles.routeDot, { backgroundColor: C.primary }]} />
          <View style={[styles.routeConnector, { backgroundColor: C.border }]} />
          <View style={[styles.routeDot, { backgroundColor: C.accent }]} />
        </View>
        <View style={styles.routeText}>
          <Text numberOfLines={1} style={[styles.addr, { color: C.text }]}>
            {delivery.pickupAddress}
          </Text>
          <Text numberOfLines={1} style={[styles.addr, { color: C.textSecondary }]}>
            {delivery.dropoffAddress}
          </Text>
        </View>
      </View>

      <View style={[styles.footer, { borderTopColor: C.border }]}>
        <View style={styles.metaItem}>
          <Feather name="package" size={13} color={C.textTertiary} />
          <Text style={[styles.meta, { color: C.textTertiary }]}>
            {delivery.packageSize ?? "package"}
          </Text>
        </View>
        {role === "sender" && delivery.courier?.name ? (
          <Text style={[styles.meta, { color: C.textTertiary }]}>{delivery.courier.name}</Text>
        ) : role === "courier" && delivery.sender?.name ? (
          <Text style={[styles.meta, { color: C.textTertiary }]}>{delivery.sender.name}</Text>
        ) : null}
        <Feather name="chevron-right" size={16} color={C.textTertiary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 12, gap: 14 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontWeight: "600" },
  price: { fontSize: 17, fontWeight: "700" },
  route: { flexDirection: "row", gap: 12 },
  routeLine: { alignItems: "center", paddingTop: 4 },
  routeDot: { width: 9, height: 9, borderRadius: 5 },
  routeConnector: { width: 2, height: 18, marginVertical: 2 },
  routeText: { flex: 1, gap: 10, justifyContent: "space-between" },
  addr: { fontSize: 14, fontWeight: "500" },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, paddingTop: 12 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  meta: { fontSize: 12, fontWeight: "500" },
});

export default DeliveryCard;
