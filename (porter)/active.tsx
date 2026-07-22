import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useListDeliveries } from "@workspace/api-client-react";
import { useColors } from "@/context/ThemeContext";
import { useUser, authedFetch } from "@/context/UserContext";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; next?: string; nextLabel?: string; icon: string }> = {
  accepted: {
    label: "Heading to Pickup",
    color: "#3B82F6",
    bg: "#EFF6FF",
    icon: "navigation",
    next: "picked_up",
    nextLabel: "Mark Picked Up",
  },
  picked_up: {
    label: "Delivering",
    color: "#8B5CF6",
    bg: "#EDE9FE",
    icon: "package",
    next: "delivered",
    nextLabel: "Mark Delivered",
  },
  delivered: { label: "Delivered", color: "#10B981", bg: "#D1FAE5", icon: "check-circle" },
};

const BOX_COLOR = "#7C3AED";

type PendingAction =
  | { type: "delivered"; deliveryId: string }
  | { type: "drop_at_box"; deliveryId: string };

export default function PorterActiveDeliveryScreen() {
  const insets = useSafeAreaInsets();
  const { user, token } = useUser();
  const C = useColors();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [dropoffPhotoUri, setDropoffPhotoUri] = useState<string | null>(null);
  const [dropoffPhotoUrl, setDropoffPhotoUrl] = useState<string | null>(null);
  const [uploadingDropoff, setUploadingDropoff] = useState(false);
  const [photoModalVisible, setPhotoModalVisible] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useListDeliveries(
    { courierId: user?.id },
    {
      query: {
        enabled: !!user?.id,
        refetchInterval: 8000,
        select: (d) => ({
          deliveries: d.deliveries.filter((del) =>
            ["accepted", "picked_up"].includes(del.status)
          ),
        }),
      },
    }
  );

  const activeDeliveries = data?.deliveries ?? [];

  const openNavigate = (lat: number | null, lng: number | null, label: string) => {
    if (!lat || !lng) return;
    const url = Platform.OS === "ios"
      ? `maps://maps.apple.com/?daddr=${lat},${lng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    Linking.openURL(url).catch(() =>
      Alert.alert("Navigation", `Open maps to navigate to:\n${label}`)
    );
  };

  const handleUpdateStatus = async (deliveryId: string, nextStatus: string) => {
    setUpdatingId(deliveryId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await authedFetch(
        token,
        `https://${DOMAIN}/api/deliveries/${deliveryId}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus, courierId: user?.id }),
        }
      );
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        refetch();
      }
    } catch {
      Alert.alert("Error", "Could not update status.");
    } finally {
      setUpdatingId(null);
    }
  };

  const uploadDropoffPhoto = async (uri: string): Promise<string | null> => {
    setUploadingDropoff(true);
    try {
      const imgRes = await fetch(uri);
      const blob = await imgRes.blob();
      const formData = new FormData();
      formData.append("photo", blob, "photo.jpg");
      const uploadRes = await authedFetch(token, `https://${DOMAIN}/api/uploads/photo`, {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { servingUrl } = await uploadRes.json() as { servingUrl: string; objectId: string };

      return servingUrl;
    } catch {
      Alert.alert("Upload failed", "Could not upload photo. Please try again.");
      return null;
    } finally {
      setUploadingDropoff(false);
    }
  };

  const captureDropoffPhoto = async (): Promise<string | null> => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera permission required", "Please enable camera access in settings.");
      return null;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.6,
    });
    if (result.canceled || !result.assets[0]) return null;
    return result.assets[0].uri;
  };

  const handleDeliverWithPhoto = async (deliveryId: string) => {
    setPendingAction({ type: "delivered", deliveryId });
    setDropoffPhotoUri(null);
    setDropoffPhotoUrl(null);
    setPhotoModalVisible(true);
  };

  const handleDropAtBoxWithPhoto = async (deliveryId: string) => {
    setPendingAction({ type: "drop_at_box", deliveryId });
    setDropoffPhotoUri(null);
    setDropoffPhotoUrl(null);
    setPhotoModalVisible(true);
  };

  const handlePhotoModalCapture = async () => {
    const uri = await captureDropoffPhoto();
    if (!uri) return;
    setDropoffPhotoUri(uri);
    const url = await uploadDropoffPhoto(uri);
    setDropoffPhotoUrl(url);
  };

  const handlePhotoModalConfirm = async () => {
    if (!pendingAction || !dropoffPhotoUrl) return;
    setPhotoModalVisible(false);
    setUpdatingId(pendingAction.deliveryId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      if (pendingAction.type === "delivered") {
        const res = await authedFetch(
          token,
          `https://${DOMAIN}/api/deliveries/${pendingAction.deliveryId}/status`,
          {
            method: "PATCH",
            body: JSON.stringify({
              status: "delivered",
              courierId: user?.id,
              dropoffPhotoUrl,
            }),
          }
        );
        if (res.ok) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          refetch();
        }
      } else if (pendingAction.type === "drop_at_box") {
        const res = await authedFetch(
          token,
          `https://${DOMAIN}/api/deliveries/${pendingAction.deliveryId}/drop-at-box`,
          {
            method: "POST",
            body: JSON.stringify({ dropoffPhotoUrl }),
          }
        );
        if (res.ok) {
          const data = await res.json();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(
            "Package Secured in Box!",
            `The sender's pickup code is: ${data.pickupCode}\n\nThey will be notified to collect their package.`,
            [{ text: "Done", onPress: () => refetch() }]
          );
        } else {
          const err = await res.json();
          Alert.alert("Error", err.error ?? "Could not drop at box.");
        }
      }
    } catch {
      Alert.alert("Error", "Could not complete action.");
    } finally {
      setUpdatingId(null);
      setPendingAction(null);
      setDropoffPhotoUri(null);
      setDropoffPhotoUrl(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <Text style={[styles.title, { color: C.text }]}>Active Delivery</Text>
        <Text style={[styles.subtitle, { color: C.textSecondary }]}>
          {activeDeliveries.length} in progress
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 100 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={C.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <ActivityIndicator color={C.accent} style={{ marginTop: 60 }} />
        ) : activeDeliveries.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: C.surface }]}>
            <View style={[styles.emptyIcon, { backgroundColor: C.accentLight }]}>
              <Feather name="truck" size={40} color={C.accent} />
            </View>
            <Text style={[styles.emptyTitle, { color: C.text }]}>No Active Deliveries</Text>
            <Text style={[styles.emptySub, { color: C.textSecondary }]}>
              Accept a job from the Jobs tab to start delivering
            </Text>
          </View>
        ) : (
          activeDeliveries.map((delivery) => {
            const st = STATUS_CONFIG[delivery.status];
            if (!st) return null;
            return (
              <View
                key={delivery.id}
                style={[styles.deliveryCard, { backgroundColor: C.surface }]}
              >
                <View style={[styles.statusBanner, { backgroundColor: st.bg }]}>
                  <Feather name={st.icon as any} size={20} color={st.color} />
                  <Text style={[styles.statusLabel, { color: st.color }]}>
                    {delivery.status === "accepted" && delivery.deliveryType === "box_dropoff"
                      ? "Heading to Porter Box"
                      : st.label}
                  </Text>
                  {delivery.deliveryType === "box_dropoff" && (
                    <View style={[styles.boxBadge, { backgroundColor: "#EDE9FE", marginLeft: "auto" as any, marginBottom: 0 }]}>
                      <Feather name="inbox" size={12} color={BOX_COLOR} />
                      <Text style={[styles.boxBadgeText, { color: BOX_COLOR, fontSize: 11 }]}>Box Drop-off</Text>
                    </View>
                  )}
                </View>

                <View style={styles.cardBody}>
                  <Text style={[styles.packageDesc, { color: C.text }]}>
                    {delivery.packageDescription}
                  </Text>

                  {delivery.packagePhotoUrl ? (
                    <View style={styles.photoWrap}>
                      <View style={styles.photoLabelRow}>
                        <Feather name="camera" size={13} color={C.textSecondary} />
                        <Text style={[styles.photoLabel, { color: C.textSecondary }]}>Package photo</Text>
                      </View>
                      <Image
                        source={{ uri: delivery.packagePhotoUrl }}
                        style={[styles.packagePhoto, { borderColor: C.border }]}
                        contentFit="cover"
                      />
                    </View>
                  ) : null}

                  <View style={styles.routeSection}>
                    <View style={styles.routeRow}>
                      <View style={[styles.dot, { backgroundColor: C.primary }]} />
                      <Text style={[styles.address, { color: C.text }]} numberOfLines={1}>
                        {delivery.pickupAddress}
                      </Text>
                    </View>
                    <View style={[styles.vertLine, { backgroundColor: C.border }]} />
                    <View style={styles.routeRow}>
                      <View style={[styles.dot, { backgroundColor: C.accent }]} />
                      <Text style={[styles.address, { color: C.text }]} numberOfLines={1}>
                        {delivery.dropoffAddress}
                      </Text>
                    </View>
                  </View>

                  {delivery.sender && (
                    <View style={styles.senderRow}>
                      <Feather name="user" size={14} color={C.textSecondary} />
                      <Text style={[styles.senderName, { color: C.textSecondary }]}>
                        {delivery.sender.name} · {delivery.sender.phone}
                      </Text>
                    </View>
                  )}

                  <View style={styles.priceRow}>
                    <Text style={[styles.price, { color: C.accent }]}>
                      ${delivery.estimatedPrice.toFixed(2)}
                    </Text>
                    {delivery.distanceKm != null && (
                      <Text style={[styles.distance, { color: C.textSecondary }]}>
                        {(delivery.distanceKm * 0.621371).toFixed(1)} mi
                      </Text>
                    )}
                  </View>

                  <Pressable
                    style={({ pressed }) => [
                      styles.navBtn,
                      { borderColor: C.border, opacity: pressed ? 0.7 : 1 },
                    ]}
                    onPress={() => {
                      const isPickup = delivery.status === "accepted";
                      openNavigate(
                        isPickup ? delivery.pickupLat : delivery.dropoffLat,
                        isPickup ? delivery.pickupLng : delivery.dropoffLng,
                        isPickup ? delivery.pickupAddress : delivery.dropoffAddress
                      );
                    }}
                  >
                    <Feather name="navigation" size={16} color={C.accent} />
                    <Text style={[styles.navBtnText, { color: C.accent }]}>
                      {delivery.status === "accepted" && delivery.deliveryType === "box_dropoff"
                        ? "Navigate to Porter Box"
                        : `Navigate to ${delivery.status === "accepted" ? "Pickup" : "Dropoff"}`}
                    </Text>
                  </Pressable>

                  {delivery.status === "picked_up" && delivery.deliveryType === "porter_box" ? (
                    <>
                      <View style={[styles.boxBadge, { backgroundColor: "#F5F0FF" }]}>
                        <Feather name="inbox" size={14} color={BOX_COLOR} />
                        <Text style={[styles.boxBadgeText, { color: BOX_COLOR }]}>Porter Box Delivery</Text>
                      </View>
                      <Pressable
                        style={({ pressed }) => [
                          styles.nextBtn,
                          {
                            backgroundColor: BOX_COLOR,
                            opacity: pressed || updatingId === delivery.id ? 0.85 : 1,
                            transform: [{ scale: pressed ? 0.98 : 1 }],
                          },
                        ]}
                        onPress={() => handleDropAtBoxWithPhoto(delivery.id)}
                        disabled={updatingId === delivery.id}
                      >
                        {updatingId === delivery.id ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <>
                            <Feather name="inbox" size={18} color="#fff" />
                            <Text style={styles.nextBtnText}>Drop at Porter Box</Text>
                          </>
                        )}
                      </Pressable>
                    </>
                  ) : delivery.status === "picked_up" && st.next === "delivered" ? (
                    <Pressable
                      style={({ pressed }) => [
                        styles.nextBtn,
                        {
                          backgroundColor: st.color,
                          opacity: pressed || updatingId === delivery.id ? 0.85 : 1,
                          transform: [{ scale: pressed ? 0.98 : 1 }],
                        },
                      ]}
                      onPress={() => handleDeliverWithPhoto(delivery.id)}
                      disabled={updatingId === delivery.id}
                    >
                      {updatingId === delivery.id ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <>
                          <Feather name="check-circle" size={18} color="#fff" />
                          <Text style={styles.nextBtnText}>{st.nextLabel}</Text>
                        </>
                      )}
                    </Pressable>
                  ) : st.next ? (
                    <Pressable
                      style={({ pressed }) => [
                        styles.nextBtn,
                        {
                          backgroundColor: st.color,
                          opacity: pressed || updatingId === delivery.id ? 0.85 : 1,
                          transform: [{ scale: pressed ? 0.98 : 1 }],
                        },
                      ]}
                      onPress={() =>
                        handleUpdateStatus(delivery.id, st.next!)
                      }
                      disabled={updatingId === delivery.id}
                    >
                      {updatingId === delivery.id ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <>
                          <Feather
                            name={delivery.status === "accepted" && delivery.deliveryType === "box_dropoff" ? "inbox" : "package"}
                            size={18}
                            color="#fff"
                          />
                          <Text style={styles.nextBtnText}>
                            {delivery.status === "accepted" && delivery.deliveryType === "box_dropoff"
                              ? "Confirm Box Pickup"
                              : st.nextLabel}
                          </Text>
                        </>
                      )}
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <Modal
        visible={photoModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!uploadingDropoff) {
            setPhotoModalVisible(false);
            setPendingAction(null);
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.photoSheet, { backgroundColor: C.surface }]}>
            <Text style={[styles.photoSheetTitle, { color: C.text }]}>Drop-off Photo Required</Text>
            <Text style={[styles.photoSheetSub, { color: C.textSecondary }]}>
              Take a photo at drop-off to confirm delivery. This protects both you and the sender.
            </Text>

            {dropoffPhotoUri ? (
              <View style={{ gap: 12 }}>
                <View style={{ position: "relative" }}>
                  <Image
                    source={{ uri: dropoffPhotoUri }}
                    style={[styles.dropoffPreview, { borderColor: C.border }]}
                    contentFit="cover"
                  />
                  {uploadingDropoff && (
                    <View style={{
                      ...StyleSheet.absoluteFillObject,
                      backgroundColor: "rgba(0,0,0,0.45)",
                      borderRadius: 14,
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}>
                      <ActivityIndicator color="#fff" size="large" />
                      <Text style={{ color: "#fff", fontSize: 13, fontFamily: "Inter_500Medium" }}>Uploading…</Text>
                    </View>
                  )}
                  {!uploadingDropoff && dropoffPhotoUrl && (
                    <View style={{
                      position: "absolute",
                      bottom: 10,
                      right: 10,
                      backgroundColor: "#22c55e",
                      borderRadius: 20,
                      padding: 6,
                    }}>
                      <Feather name="check" size={14} color="#fff" />
                    </View>
                  )}
                </View>
                <Pressable
                  style={({ pressed }) => [styles.retakeRow, { opacity: pressed ? 0.6 : 1 }]}
                  onPress={() => { setDropoffPhotoUri(null); setDropoffPhotoUrl(null); }}
                  disabled={uploadingDropoff}
                >
                  <Feather name="refresh-cw" size={14} color={C.textSecondary} />
                  <Text style={[styles.retakeText, { color: C.textSecondary }]}>Retake photo</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={({ pressed }) => [
                  styles.cameraBtn,
                  { backgroundColor: "#123E6B", opacity: pressed ? 0.85 : 1 },
                ]}
                onPress={handlePhotoModalCapture}
              >
                <Feather name="camera" size={22} color="#fff" />
                <Text style={styles.cameraBtnText}>Take Photo</Text>
              </Pressable>
            )}

            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.modalCancelBtn,
                  { borderColor: C.border, opacity: pressed ? 0.6 : 1 },
                ]}
                onPress={() => {
                  setPhotoModalVisible(false);
                  setPendingAction(null);
                  setDropoffPhotoUri(null);
                  setDropoffPhotoUrl(null);
                }}
                disabled={uploadingDropoff}
              >
                <Text style={[styles.modalCancelText, { color: C.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.modalConfirmBtn,
                  {
                    backgroundColor: dropoffPhotoUrl && !uploadingDropoff ? "#123E6B" : C.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
                onPress={handlePhotoModalConfirm}
                disabled={!dropoffPhotoUrl || uploadingDropoff}
              >
                <Text style={[
                  styles.modalConfirmText,
                  { color: dropoffPhotoUrl && !uploadingDropoff ? "#fff" : C.textSecondary },
                ]}>
                  {pendingAction?.type === "drop_at_box" ? "Drop at Box" : "Confirm Delivery"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 2 },
  list: { paddingHorizontal: 20, paddingTop: 8, gap: 16 },
  emptyCard: {
    borderRadius: 24,
    padding: 40,
    alignItems: "center",
    gap: 16,
    marginTop: 20,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_600SemiBold" },
  emptySub: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 280,
  },
  deliveryCard: {
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 3,
  },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    paddingHorizontal: 18,
  },
  statusLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardBody: { padding: 18, gap: 16 },
  packageDesc: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  routeSection: { gap: 6 },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  vertLine: { height: 1, marginLeft: 20 },
  address: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  senderRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  senderName: { fontSize: 13, fontFamily: "Inter_400Regular" },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  price: { fontSize: 22, fontFamily: "Inter_700Bold", flex: 1 },
  distance: { fontSize: 14, fontFamily: "Inter_400Regular" },
  navBtn: {
    borderRadius: 14,
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
  },
  navBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  nextBtn: {
    borderRadius: 14,
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  nextBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  boxBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  boxBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  photoWrap: { gap: 8 },
  photoLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  photoLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  packagePhoto: {
    width: "100%",
    height: 180,
    borderRadius: 14,
    borderWidth: 1.5,
    overflow: "hidden",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  photoSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    gap: 18,
  },
  photoSheetTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  photoSheetSub: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  dropoffPreview: {
    width: "100%",
    height: 200,
    borderRadius: 14,
    borderWidth: 1.5,
    overflow: "hidden",
  },
  retakeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "center",
  },
  retakeText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  cameraBtn: {
    borderRadius: 14,
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  cameraBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  modalActions: { flexDirection: "row", gap: 12 },
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
  modalConfirmText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
