import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useGetDelivery, useGetDeliveryTracking } from "@workspace/api-client-react";
import { useColors } from "@/context/ThemeContext";
import { useUser, authedFetch } from "@/context/UserContext";
import { RatingModal } from "@/components/RatingModal";

const STATUS_STEPS = ["pending", "accepted", "picked_up", "delivered"];

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  pending: { label: "Awaiting Porter", color: "#F59E0B", bg: "#FEF3C7", icon: "clock" },
  in_box: { label: "In Porter Box", color: "#7C3AED", bg: "#EDE9FE", icon: "inbox" },
  accepted: { label: "Porter On The Way", color: "#3B82F6", bg: "#EFF6FF", icon: "navigation" },
  picked_up: { label: "Package Picked Up", color: "#8B5CF6", bg: "#EDE9FE", icon: "package" },
  delivered: { label: "Delivered!", color: "#10B981", bg: "#D1FAE5", icon: "check-circle" },
  cancelled: { label: "Cancelled", color: "#EF4444", bg: "#FEE2E2", icon: "x-circle" },
};

export default function DeliveryDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, token } = useUser();
  const C = useColors();
  const isWeb = Platform.OS === "web";
  const [showRating, setShowRating] = useState(false);
  const [ratingDismissed, setRatingDismissed] = useState(false);
  const [confirmDepositLoading, setConfirmDepositLoading] = useState(false);

  const { data: delivery, isLoading, refetch } = useGetDelivery(id ?? "", {
    query: { enabled: !!id, refetchInterval: 5000 },
  });

  const { data: tracking } = useGetDeliveryTracking(id ?? "", {
    query: {
      enabled: !!id && !!delivery && !["delivered", "cancelled"].includes(delivery.status),
      refetchInterval: 8000,
    },
  });

  const isBoxDropoff = delivery?.deliveryType === "box_dropoff";
  const statusBase = delivery?.status ? STATUS_CONFIG[delivery.status] : null;
  const status = statusBase && isBoxDropoff && delivery?.status === "pending"
    ? { ...statusBase, label: "Awaiting Arrival" }
    : statusBase;
  const STATUS_STEPS_DISPLAY = isBoxDropoff
    ? ["pending", "in_box", "accepted", "picked_up", "delivered"]
    : ["pending", "accepted", "picked_up", "delivered"];
  const stepIndex = STATUS_STEPS_DISPLAY.indexOf(delivery?.status ?? "");

  useEffect(() => {
    if (
      delivery?.status === "delivered" &&
      delivery?.courier &&
      user?.role === "sender" &&
      !ratingDismissed
    ) {
      const t = setTimeout(() => setShowRating(true), 800);
      return () => clearTimeout(t);
    }
  }, [delivery?.status, ratingDismissed]);

  const handleCancel = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert("Cancel Delivery", "Are you sure you want to cancel?", [
      { text: "Keep It", style: "cancel" },
      {
        text: "Cancel Delivery",
        style: "destructive",
        onPress: async () => {
          await authedFetch(
            token,
            `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/deliveries/${id}/status`,
            {
              method: "PATCH",
              body: JSON.stringify({ status: "cancelled" }),
            }
          );
          refetch();
        },
      },
    ]);
  };

  const handleConfirmDeposit = async () => {
    if (confirmDepositLoading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setConfirmDepositLoading(true);
    try {
      const res = await authedFetch(
        token,
        `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/deliveries/${id}/confirm-deposit`,
        { method: "POST" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        Alert.alert("Error", (err as any).error ?? "Could not confirm deposit. Please try again.");
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        refetch();
      }
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setConfirmDepositLoading(false);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: C.background }]}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  if (!delivery) {
    return (
      <View style={[styles.center, { backgroundColor: C.background }]}>
        <Text style={{ color: C.text, fontSize: 18, fontFamily: "Inter_600SemiBold" }}>
          Delivery not found
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <View
        style={[
          styles.navBar,
          { paddingTop: isWeb ? 67 : insets.top + 8 },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={[styles.navTitle, { color: C.text }]}>Delivery Details</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 30 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {status && (
          <View style={[styles.statusCard, { backgroundColor: status.bg }]}>
            <View style={styles.statusRow}>
              <Feather name={status.icon as any} size={28} color={status.color} />
              <View style={styles.statusInfo}>
                <Text style={[styles.statusLabel, { color: status.color }]}>
                  {status.label}
                </Text>
                {delivery.courier && delivery.status === "accepted" && (
                  <Text style={[styles.courierInfo, { color: status.color }]}>
                    {delivery.courier.name} {isBoxDropoff ? "is heading to the porter box" : "is on the way to you"}
                  </Text>
                )}
                {tracking?.courierLat && tracking?.courierLng && (
                  <Text style={[styles.courierInfo, { color: status.color }]}>
                    Live tracking active
                  </Text>
                )}
              </View>
            </View>

            {delivery.status !== "cancelled" && (
              <View style={styles.steps}>
                {STATUS_STEPS_DISPLAY.map((s, i) => (
                  <View key={s} style={styles.stepItem}>
                    <View
                      style={[
                        styles.stepDot,
                        {
                          backgroundColor:
                            i <= stepIndex ? status.color : C.border,
                        },
                      ]}
                    >
                      {i < stepIndex && (
                        <Feather name="check" size={10} color="#fff" />
                      )}
                    </View>
                    {i < STATUS_STEPS.length - 1 && (
                      <View
                        style={[
                          styles.stepLine,
                          { backgroundColor: i < stepIndex ? status.color : C.border },
                        ]}
                      />
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        <View style={[styles.infoCard, { backgroundColor: C.surface }]}>
          <Text style={[styles.cardTitle, { color: C.text }]}>Package Details</Text>
          <Row icon="package" label="Type" value={delivery.packageDescription} />
          <Row
            icon="box"
            label="Size"
            value={delivery.packageSize.replace("_", " ")}
          />
          {delivery.distanceKm != null && (
            <Row icon="map" label="Distance" value={`${(delivery.distanceKm * 0.621371).toFixed(1)} mi`} />
          )}
          {delivery.notes && <Row icon="file-text" label="Notes" value={delivery.notes} />}
        </View>

        <View style={[styles.infoCard, { backgroundColor: C.surface }]}>
          <Text style={[styles.cardTitle, { color: C.text }]}>Route</Text>
          <View style={styles.routeContainer}>
            <View style={styles.routeLeft}>
              <View style={[styles.dot, { backgroundColor: C.primary }]} />
              <View style={[styles.routeVertLine, { backgroundColor: C.border }]} />
              <View style={[styles.dot, { backgroundColor: C.accent }]} />
            </View>
            <View style={styles.routeRight}>
              <View style={styles.routeStop}>
                <Text style={[styles.routeStopLabel, { color: C.textSecondary }]}>
                  {isBoxDropoff ? "PORTER BOX" : "PICKUP"}
                </Text>
                <Text style={[styles.routeAddress, { color: C.text }]}>
                  {delivery.pickupAddress}
                </Text>
              </View>
              <View style={styles.routeStop}>
                <Text style={[styles.routeStopLabel, { color: C.textSecondary }]}>
                  DROP-OFF
                </Text>
                <Text style={[styles.routeAddress, { color: C.text }]}>
                  {delivery.dropoffAddress}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {delivery.courier && (
          <View style={[styles.infoCard, { backgroundColor: C.surface }]}>
            <Text style={[styles.cardTitle, { color: C.text }]}>Your Porter</Text>
            <View style={styles.courierCard}>
              <View style={[styles.courierAvatar, { backgroundColor: C.accentLight }]}>
                <Text style={[styles.courierAvatarText, { color: C.accent }]}>
                  {delivery.courier.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.courierName, { color: C.text }]}>
                  {delivery.courier.name}
                </Text>
                {delivery.courier.rating != null && (
                  <View style={styles.ratingRow}>
                    <Feather name="star" size={13} color="#F59E0B" />
                    <Text style={[styles.rating, { color: C.textSecondary }]}>
                      {delivery.courier.rating.toFixed(1)}
                    </Text>
                  </View>
                )}
              </View>
              <Pressable
                style={[styles.callBtn, { backgroundColor: C.primaryLight }]}
                onPress={() => Haptics.selectionAsync()}
              >
                <Feather name="phone" size={18} color={C.primary} />
              </Pressable>
            </View>
          </View>
        )}

        <View style={[styles.priceCard, { backgroundColor: C.dark }]}>
          <Text style={styles.priceLabel}>Estimated Cost</Text>
          <Text style={styles.priceValue}>
            ${delivery.estimatedPrice.toFixed(2)}
          </Text>
        </View>

        {isBoxDropoff && delivery.status === "pending" && delivery.pickupLat != null && delivery.pickupLng != null && (
          <Pressable
            style={({ pressed }) => [
              styles.navigateBtn,
              { opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
            ]}
            onPress={async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              const lat = delivery.pickupLat;
              const lng = delivery.pickupLng;
              const label = encodeURIComponent(delivery.pickupAddress);
              const url = Platform.select({
                ios: `maps://?daddr=${lat},${lng}&q=${label}`,
                android: `geo:${lat},${lng}?q=${lat},${lng}(${label})`,
                default: `https://maps.google.com/?q=${lat},${lng}`,
              }) as string;
              try {
                const canOpen = await Linking.canOpenURL(url);
                if (canOpen) {
                  Linking.openURL(url);
                } else {
                  Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`);
                }
              } catch {
                Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`);
              }
            }}
          >
            <Feather name="navigation" size={18} color="#fff" />
            <Text style={styles.navigateBtnText}>Navigate to Porter Box</Text>
            <Feather name="chevron-right" size={16} color="rgba(255,255,255,0.7)" />
          </Pressable>
        )}

        {isBoxDropoff && delivery.status === "pending" && (
          <View style={[styles.infoCard, { backgroundColor: "#F5F0FF", borderWidth: 1, borderColor: "#DDD6FE" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Feather name="inbox" size={20} color="#7C3AED" />
              <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#7C3AED", flex: 1 }}>
                Deposit Your Package
              </Text>
            </View>
            <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: "#6D28D9", lineHeight: 20 }}>
              Go to the Porter Box and place your package inside. Once deposited, tap the button below — a porter will be notified to pick it up.
            </Text>
            <Pressable
              onPress={handleConfirmDeposit}
              disabled={confirmDepositLoading}
              style={({ pressed }) => ({
                marginTop: 4,
                backgroundColor: confirmDepositLoading ? "#A78BFA" : "#7C3AED",
                borderRadius: 14,
                height: 52,
                flexDirection: "row" as const,
                alignItems: "center" as const,
                justifyContent: "center" as const,
                gap: 10,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              {confirmDepositLoading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Feather name="check-circle" size={18} color="#fff" />
              }
              <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" }}>
                {confirmDepositLoading ? "Confirming…" : "I've Deposited My Package"}
              </Text>
            </Pressable>
          </View>
        )}

        {isBoxDropoff && delivery.status === "in_box" && (
          <View style={[styles.infoCard, { backgroundColor: "#F5F0FF", borderWidth: 1, borderColor: "#DDD6FE" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Feather name="check-circle" size={20} color="#7C3AED" />
              <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#7C3AED", flex: 1 }}>
                Package Deposited!
              </Text>
            </View>
            <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: "#6D28D9", lineHeight: 20 }}>
              A nearby porter will collect your package and deliver it to the recipient. Keep this code — the porter needs it to verify pickup:
            </Text>
            {delivery.pickupCode ? (
              <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
                {delivery.pickupCode.split("").map((char: string, i: number) => (
                  <View
                    key={i}
                    style={{
                      width: 40,
                      height: 48,
                      borderRadius: 10,
                      backgroundColor: "#fff",
                      borderWidth: 2,
                      borderColor: "#7C3AED",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ fontSize: 22, fontFamily: "Inter_700Bold", color: "#7C3AED" }}>{char}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        )}

        {(["accepted", "picked_up"].includes(delivery.status) ||
          (delivery.status === "in_box" && isBoxDropoff)) && (
          <Pressable
            style={({ pressed }) => [
              styles.trackBtn,
              { backgroundColor: C.accent, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push({ pathname: "/tracking/[id]", params: { id } });
            }}
          >
            <View style={styles.liveDot} />
            <Feather name="map-pin" size={18} color="#fff" />
            <Text style={styles.trackBtnText}>Watch Live Tracking</Text>
            <Feather name="chevron-right" size={16} color="rgba(255,255,255,0.7)" />
          </Pressable>
        )}

        {user?.role === "sender" && ["pending", "in_box"].includes(delivery.status) && (
          <Pressable
            style={({ pressed }) => [
              styles.cancelBtn,
              { borderColor: C.error, opacity: pressed ? 0.7 : 1 },
            ]}
            onPress={handleCancel}
          >
            <Feather name="x-circle" size={18} color={C.error} />
            <Text style={[styles.cancelText, { color: C.error }]}>
              Cancel Delivery
            </Text>
          </Pressable>
        )}

        {user?.role === "sender" && delivery.status === "delivered" && delivery.courier && (
          <Pressable
            style={({ pressed }) => [
              styles.rateBtn,
              { backgroundColor: C.warning, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
            ]}
            onPress={() => setShowRating(true)}
          >
            <Feather name="star" size={18} color="#fff" />
            <Text style={styles.rateBtnText}>Rate Your Porter</Text>
          </Pressable>
        )}
      </ScrollView>

      {delivery.courier && id && (
        <RatingModal
          visible={showRating}
          courierName={delivery.courier.name}
          deliveryId={id}
          onClose={() => { setShowRating(false); setRatingDismissed(true); }}
        />
      )}
    </View>
  );
}

function Row({ icon, label, value }: { icon: string; label: string; value: string }) {
  const C = useColors();
  return (
    <View style={styles.row}>
      <Feather name={icon as any} size={16} color={C.textSecondary} />
      <Text style={[styles.rowLabel, { color: C.textSecondary }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: C.text }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  navTitle: { flex: 1, textAlign: "center", fontSize: 18, fontFamily: "Inter_600SemiBold" },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 16 },
  statusCard: { borderRadius: 20, padding: 20, gap: 16 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  statusInfo: { flex: 1 },
  statusLabel: { fontSize: 18, fontFamily: "Inter_700Bold" },
  courierInfo: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4, opacity: 0.8 },
  steps: { flexDirection: "row", alignItems: "center" },
  stepItem: { flexDirection: "row", alignItems: "center", flex: 1 },
  stepDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  stepLine: { flex: 1, height: 2 },
  infoCard: {
    borderRadius: 20,
    padding: 20,
    gap: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  rowLabel: { fontSize: 14, fontFamily: "Inter_400Regular", width: 70 },
  rowValue: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  routeContainer: { flexDirection: "row", gap: 16 },
  routeLeft: { alignItems: "center", paddingTop: 4 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  routeVertLine: { width: 2, flex: 1, marginVertical: 4 },
  routeRight: { flex: 1, gap: 20 },
  routeStop: { gap: 4 },
  routeStopLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  routeAddress: { fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 20 },
  courierCard: { flexDirection: "row", alignItems: "center", gap: 14 },
  courierAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  courierAvatarText: { fontSize: 20, fontFamily: "Inter_700Bold" },
  courierName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  rating: { fontSize: 13, fontFamily: "Inter_400Regular" },
  callBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  priceCard: {
    borderRadius: 20,
    padding: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  priceLabel: { color: "rgba(255,255,255,0.7)", fontSize: 15, fontFamily: "Inter_400Regular" },
  priceValue: { color: "#fff", fontSize: 28, fontFamily: "Inter_700Bold" },
  cancelBtn: {
    borderRadius: 16,
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 2,
  },
  cancelText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  trackBtn: {
    borderRadius: 16,
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowColor: "#6FA3C8",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 6,
  },
  trackBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold", flex: 1 },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#EF4444",
    shadowColor: "#EF4444",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 4,
  },
  rateBtn: {
    borderRadius: 16,
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowColor: "#F59E0B",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  rateBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  navigateBtn: {
    borderRadius: 16,
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    gap: 10,
    backgroundColor: "#7C3AED",
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 6,
  },
  navigateBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold", flex: 1 },
});
