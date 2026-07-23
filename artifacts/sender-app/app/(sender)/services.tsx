import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/context/ThemeContext";
import { useUser, authedFetch } from "@/context/UserContext";

type InBoxDelivery = {
  id: string;
  packageDescription: string;
  packageSize: string;
  pickupAddress: string;
  dropoffAddress: string;
  estimatedPrice: number;
  porterBoxName: string | null;
  pickupCode: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

export default function ServicesScreen() {
  const insets = useSafeAreaInsets();
  const C = useColors();
  const { user, token } = useUser();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 16 : insets.top;

  const [view, setView] = useState<"home" | "pickup">("home");
  const [inBoxDeliveries, setInBoxDeliveries] = useState<InBoxDelivery[]>([]);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);
  const [codeModalVisible, setCodeModalVisible] = useState(false);
  const [activeDelivery, setActiveDelivery] = useState<InBoxDelivery | null>(null);
  const [enteredCode, setEnteredCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successId, setSuccessId] = useState<string | null>(null);

  const fetchInBoxDeliveries = useCallback(async () => {
    if (!user?.id) return;
    setLoadingDeliveries(true);
    try {
      const res = await authedFetch(
        token,
        `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/deliveries?senderId=${user.id}&status=in_box`
      );
      if (res.ok) {
        const data = await res.json();
        setInBoxDeliveries(data.deliveries ?? []);
      }
    } catch {}
    setLoadingDeliveries(false);
  }, [user?.id, token]);

  useEffect(() => {
    if (view === "pickup") fetchInBoxDeliveries();
  }, [view]);

  const handlePickup = async () => {
    if (!activeDelivery || !enteredCode.trim()) return;
    setSubmitting(true);
    try {
      const res = await authedFetch(
        token,
        `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/porter-boxes/pickup`,
        {
          method: "POST",
          body: JSON.stringify({
            deliveryId: activeDelivery.id,
            code: enteredCode.trim().toUpperCase(),
          }),
        }
      );
      const data = await res.json();
      if (res.ok) {
        setCodeModalVisible(false);
        setSuccessId(activeDelivery.id);
        setEnteredCode("");
        fetchInBoxDeliveries();
        Alert.alert("Collected!", data.message ?? "Package collected successfully!");
      } else {
        Alert.alert("Error", data.error ?? "Incorrect code. Please try again.");
      }
    } catch {
      Alert.alert("Error", "Could not verify code. Please try again.");
    }
    setSubmitting(false);
  };

  if (view === "pickup") {
    return (
      <View style={[styles.container, { backgroundColor: C.background, paddingTop: topPad + 8 }]}>
        <View style={styles.pickupHeader}>
          <Pressable
            onPress={() => setView("home")}
            style={({ pressed }) => [styles.backBtn, { backgroundColor: C.surfaceSecondary, opacity: pressed ? 0.7 : 1 }]}
          >
            <Feather name="arrow-left" size={20} color={C.text} />
          </Pressable>
          <Text style={[styles.title, { color: C.text }]}>Porter Box Pickup</Text>
        </View>

        <Text style={[styles.pickupSubtitle, { color: C.textSecondary }]}>
          Packages waiting at a secure Porter Box
        </Text>

        {loadingDeliveries ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
        ) : inBoxDeliveries.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: C.surface }]}>
            <View style={[styles.emptyIconWrap, { backgroundColor: C.primaryLight }]}>
              <Feather name="inbox" size={36} color={C.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: C.text }]}>No packages waiting</Text>
            <Text style={[styles.emptySub, { color: C.textSecondary }]}>
              When a porter drops your package in a box, it will appear here
            </Text>
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.deliveryList} showsVerticalScrollIndicator={false}>
            {inBoxDeliveries.map((delivery) => (
              <View key={delivery.id} style={[styles.deliveryCard, { backgroundColor: C.surface }]}>
                <View style={[styles.inBoxBadge, { backgroundColor: "#F5F0FF" }]}>
                  <Feather name="inbox" size={16} color="#7C3AED" />
                  <Text style={[styles.inBoxBadgeText, { color: "#7C3AED" }]}>Ready for pickup</Text>
                </View>

                <Text style={[styles.deliveryDesc, { color: C.text }]}>{delivery.packageDescription}</Text>

                <View style={styles.packageMeta}>
                  <View style={[styles.sizeBadge, { backgroundColor: C.primaryLight }]}>
                    <Feather name="package" size={12} color={C.primary} />
                    <Text style={[styles.sizeText, { color: C.primary }]}>
                      {delivery.packageSize.charAt(0).toUpperCase() + delivery.packageSize.slice(1)} package
                    </Text>
                  </View>
                  <Text style={[styles.priceText, { color: "#7C3AED" }]}>
                    ${delivery.estimatedPrice.toFixed(2)}
                  </Text>
                </View>

                {delivery.porterBoxName && (
                  <View style={[styles.boxNameRow, { backgroundColor: "#EDE9FE" }]}>
                    <Feather name="inbox" size={14} color="#7C3AED" />
                    <Text style={[styles.boxNameText, { color: "#7C3AED" }]}>
                      {delivery.porterBoxName}
                    </Text>
                  </View>
                )}

                <View style={styles.deliveryRoute}>
                  <View style={styles.routeRow}>
                    <View style={[styles.dot, { backgroundColor: C.primary }]} />
                    <Text style={[styles.routeAddr, { color: C.textSecondary }]} numberOfLines={1}>
                      From: {delivery.pickupAddress}
                    </Text>
                  </View>
                  <View style={styles.routeRow}>
                    <View style={[styles.dot, { backgroundColor: "#7C3AED" }]} />
                    <Text style={[styles.routeAddr, { color: C.textSecondary }]} numberOfLines={1}>
                      {delivery.dropoffAddress}
                    </Text>
                  </View>
                </View>

                <View style={[styles.codeCard, { backgroundColor: "#F5F0FF", borderColor: "#7C3AED" }]}>
                  <Text style={styles.codeLabel}>Your Pickup Code</Text>
                  <Text style={styles.codeValue}>{delivery.pickupCode ?? "------"}</Text>
                  <Text style={styles.codeHint}>Enter this code on the Porter Box keypad</Text>
                </View>

                {successId === delivery.id ? (
                  <View style={[styles.successBanner, { backgroundColor: "#D1FAE5" }]}>
                    <Feather name="check-circle" size={16} color="#10B981" />
                    <Text style={[styles.successText, { color: "#10B981" }]}>Collected!</Text>
                  </View>
                ) : (
                  <Pressable
                    style={({ pressed }) => [
                      styles.pickupBtn,
                      { backgroundColor: "#7C3AED", opacity: pressed ? 0.85 : 1 },
                    ]}
                    onPress={() => {
                      setActiveDelivery(delivery);
                      setEnteredCode("");
                      setCodeModalVisible(true);
                    }}
                  >
                    <Feather name="unlock" size={18} color="#fff" />
                    <Text style={styles.pickupBtnText}>Confirm Box Pickup</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </ScrollView>
        )}

        <Modal
          visible={codeModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setCodeModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { backgroundColor: C.surface }]}>
              <Text style={[styles.modalTitle, { color: C.text }]}>Confirm Pickup</Text>
              <Text style={[styles.modalSub, { color: C.textSecondary }]}>
                Enter the code shown on the Porter Box screen to confirm collection
              </Text>
              <TextInput
                style={[styles.codeInput, { borderColor: "#7C3AED", color: C.text, backgroundColor: C.background }]}
                placeholder="Enter code (e.g. A3B7X2)"
                placeholderTextColor={C.textTertiary}
                value={enteredCode}
                onChangeText={(t) => setEnteredCode(t.toUpperCase())}
                autoCapitalize="characters"
                maxLength={6}
              />
              <View style={styles.modalBtns}>
                <Pressable
                  onPress={() => setCodeModalVisible(false)}
                  style={[styles.modalCancelBtn, { borderColor: C.border }]}
                >
                  <Text style={[styles.modalCancelText, { color: C.textSecondary }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handlePickup}
                  disabled={submitting || enteredCode.length < 6}
                  style={[
                    styles.modalConfirmBtn,
                    { backgroundColor: enteredCode.length >= 6 ? "#7C3AED" : C.border },
                  ]}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.modalConfirmText}>Confirm Pickup</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: C.background, paddingTop: topPad + 20 }]}>
      <Text style={[styles.title, { color: C.text }]}>Services</Text>
      <Text style={[styles.subtitle, { color: C.textSecondary }]}>
        Secure, flexible delivery options
      </Text>

      <View style={styles.cardsWrap}>
        <Pressable
          onPress={() => setView("pickup")}
          style={({ pressed }) => [
            styles.serviceCard,
            { backgroundColor: C.surface, borderColor: "#7C3AED", opacity: pressed ? 0.92 : 1 },
          ]}
        >
          <View style={[styles.serviceCardIcon, { backgroundColor: "#F5F0FF" }]}>
            <Feather name="inbox" size={30} color="#7C3AED" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.serviceCardTitle, { color: C.text }]}>Porter Box Pickup</Text>
            <Text style={[styles.serviceCardDesc, { color: C.textSecondary }]}>
              Collect your package from a secure Porter Box using your unique pickup code
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color="#7C3AED" />
        </Pressable>

        <Pressable
          onPress={() => router.push({ pathname: "/(sender)/send", params: { prefillMode: "drop-off" } })}
          style={({ pressed }) => [
            styles.serviceCard,
            { backgroundColor: C.surface, borderColor: "#7C3AED", opacity: pressed ? 0.92 : 1 },
          ]}
        >
          <View style={[styles.serviceCardIcon, { backgroundColor: "#F5F0FF" }]}>
            <Feather name="archive" size={30} color="#7C3AED" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.serviceCardTitle, { color: C.text }]}>Porter Box Drop Off</Text>
            <Text style={[styles.serviceCardDesc, { color: C.textSecondary }]}>
              Drop your items at a Porter Box for a porter to collect and deliver
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color="#7C3AED" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.5, marginBottom: 4 },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", marginBottom: 24 },
  cardsWrap: { gap: 16 },
  serviceCard: {
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  serviceCardIcon: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  serviceCardTitle: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 4 },
  serviceCardDesc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  pickupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 6,
    paddingTop: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  pickupSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 20 },

  emptyCard: {
    borderRadius: 24,
    padding: 40,
    alignItems: "center",
    gap: 16,
    marginTop: 20,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  emptySub: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 280,
  },

  deliveryList: { gap: 16, paddingBottom: 100 },
  deliveryCard: {
    borderRadius: 20,
    padding: 18,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 3,
  },
  inBoxBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  inBoxBadgeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  deliveryDesc: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  packageMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sizeBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  sizeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  priceText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  boxNameRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  boxNameText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  deliveryRoute: { gap: 6 },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  routeAddr: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  codeCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 16,
    alignItems: "center",
    gap: 4,
  },
  codeLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#7C3AED", textTransform: "uppercase", letterSpacing: 0.6 },
  codeValue: { fontSize: 36, fontFamily: "Inter_700Bold", color: "#7C3AED", letterSpacing: 6 },
  codeHint: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9D7ED4", textAlign: "center" },
  pickupBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    height: 50,
  },
  pickupBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  successBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    height: 50,
  },
  successText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    gap: 16,
  },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  modalSub: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  codeInput: {
    borderWidth: 2,
    borderRadius: 14,
    height: 56,
    paddingHorizontal: 16,
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    letterSpacing: 6,
  },
  modalBtns: { flexDirection: "row", gap: 12 },
  modalCancelBtn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  modalConfirmBtn: {
    flex: 2,
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  modalConfirmText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});
