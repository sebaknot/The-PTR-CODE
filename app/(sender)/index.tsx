import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useListDeliveries } from "@workspace/api-client-react";
import { useColors } from "@/context/ThemeContext";
import { useUser } from "@/context/UserContext";
import { DeliveryCard } from "@/components/DeliveryCard";

type FeatherIconName = ComponentProps<typeof Feather>["name"];

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function buildStaticMapUrl(): string | null {
  if (!MAPBOX_TOKEN) return null;
  const w = 700;
  const h = 300;
  const center = "-73.9857,40.7484";
  const zoom = 12;
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${center},${zoom},0/${w}x${h}@2x?access_token=${MAPBOX_TOKEN}&logo=false&attribution=false`;
}

type QuickAddress = {
  id: string;
  icon: FeatherIconName;
  label: string;
  subtitle: string;
  address?: string;
  lat?: number;
  lng?: number;
};

const SAVED_ADDRESSES: QuickAddress[] = [
  { id: "home", icon: "home", label: "Home", subtitle: "Add your home address" },
  { id: "work", icon: "briefcase", label: "Work", subtitle: "Add your work address" },
];

export default function SenderHomeScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const C = useColors();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 16 : insets.top;
  const bottomPad = isWeb ? 34 : insets.bottom;
  const [demoLoading, setDemoLoading] = useState(false);

  const handleDemo = async () => {
    setDemoLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await fetch(
        `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/demo/seed`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push({ pathname: "/tracking/[id]", params: { id: data.deliveryId } });
    } catch {
      Alert.alert("Demo Failed", "Could not start the demo. Please try again.");
    } finally {
      setDemoLoading(false);
    }
  };

  const { data, isLoading, refetch, isRefetching } = useListDeliveries(
    { senderId: user?.id },
    { query: { enabled: !!user?.id, refetchInterval: 10000 } }
  );

  const allDeliveries = data?.deliveries ?? [];
  const activeDeliveries = allDeliveries.filter(
    (d) => !["delivered", "cancelled"].includes(d.status)
  );
  const recentDropoffs: QuickAddress[] = allDeliveries
    .filter((d) => d.dropoffAddress && d.dropoffLat != null && d.dropoffLng != null)
    .slice(0, 3)
    .map((d) => ({
      id: d.id,
      icon: "clock",
      label: d.dropoffAddress,
      subtitle: "",
      address: d.dropoffAddress,
      lat: d.dropoffLat,
      lng: d.dropoffLng,
    }));

  const quickAddresses = [...SAVED_ADDRESSES, ...recentDropoffs];
  const mapUrl = buildStaticMapUrl();

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: C.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 20, paddingBottom: bottomPad + 100 },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor={C.primary}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View>
          <Text style={[styles.greeting, { color: C.text }]}>
            {getGreeting()}, {user?.name?.split(" ")[0] ?? "there"}
          </Text>
        </View>
        <Pressable
          style={[styles.notifBtn, { backgroundColor: C.surface }]}
          onPress={() => Haptics.selectionAsync()}
        >
          <Feather name="bell" size={20} color={C.text} />
        </Pressable>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.searchBar,
          {
            backgroundColor: C.surface,
            borderColor: C.border,
            opacity: pressed ? 0.85 : 1,
            transform: [{ scale: pressed ? 0.99 : 1 }],
          },
        ]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push("/(sender)/send");
        }}
      >
        <Feather name="search" size={18} color={C.textSecondary} />
        <Text style={[styles.searchText, { color: C.textTertiary }]}>
          Where to?
        </Text>
      </Pressable>

      <View style={[styles.quickList, { backgroundColor: C.surface }]}>
        {quickAddresses.map((addr, idx) => (
          <React.Fragment key={addr.id}>
            <Pressable
              style={({ pressed }) => [
                styles.quickRow,
                { opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={() => {
                Haptics.selectionAsync();
                if (addr.address && addr.lat != null && addr.lng != null) {
                  router.push({
                    pathname: "/(sender)/send",
                    params: {
                      prefillDropoffAddress: addr.address,
                      prefillDropoffLat: String(addr.lat),
                      prefillDropoffLng: String(addr.lng),
                    },
                  });
                } else {
                  router.push("/(sender)/send");
                }
              }}
            >
              <View style={[styles.quickIcon, { backgroundColor: C.primaryLight }]}>
                <Feather name={addr.icon} size={16} color={C.primary} />
              </View>
              <View style={styles.quickInfo}>
                <Text style={[styles.quickLabel, { color: C.text }]} numberOfLines={1}>
                  {addr.label}
                </Text>
                {addr.subtitle ? (
                  <Text style={[styles.quickSub, { color: C.textSecondary }]} numberOfLines={1}>
                    {addr.subtitle}
                  </Text>
                ) : null}
              </View>
              <Feather name="chevron-right" size={16} color={C.textTertiary} />
            </Pressable>
            {idx < quickAddresses.length - 1 && (
              <View style={[styles.divider, { backgroundColor: C.border }]} />
            )}
          </React.Fragment>
        ))}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Active Porters</Text>
          <Pressable
            style={({ pressed }) => [styles.demoBtn, { opacity: pressed || demoLoading ? 0.75 : 1 }]}
            onPress={handleDemo}
            disabled={demoLoading}
          >
            {demoLoading ? (
              <ActivityIndicator color={C.accent} size="small" />
            ) : (
              <Feather name="play-circle" size={14} color={C.accent} />
            )}
            <Text style={[styles.demoBtnText, { color: C.accent }]}>
              {demoLoading ? "Starting…" : "Try demo"}
            </Text>
          </Pressable>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.mapCard,
            { backgroundColor: C.surface, opacity: pressed ? 0.95 : 1 },
          ]}
          onPress={handleDemo}
          disabled={demoLoading}
        >
          {mapUrl ? (
            <Image
              source={{ uri: mapUrl }}
              style={styles.mapImage}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.mapPlaceholder, { backgroundColor: C.border }]}>
              <Feather name="map" size={32} color={C.textTertiary} />
              <Text style={[styles.mapPlaceholderText, { color: C.textSecondary }]}>
                Map unavailable
              </Text>
            </View>
          )}

          {activeDeliveries.length > 0 && (
            <View style={styles.mapBadge}>
              <View style={styles.mapBadgeDot} />
              <Text style={styles.mapBadgeText}>
                {activeDeliveries.length} active {activeDeliveries.length === 1 ? "delivery" : "deliveries"}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      {activeDeliveries.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Active Orders</Text>
          {isLoading ? (
            <ActivityIndicator color={C.primary} style={{ marginTop: 16 }} />
          ) : (
            activeDeliveries.map((d) => (
              <DeliveryCard key={d.id} delivery={d} role="sender" />
            ))
          )}
        </View>
      )}

      {!isLoading && activeDeliveries.length === 0 && (
        <View style={[styles.emptyCard, { backgroundColor: C.surface }]}>
          <Feather name="package" size={36} color={C.textTertiary} />
          <Text style={[styles.emptyTitle, { color: C.text }]}>No active orders</Text>
          <Text style={[styles.emptySub, { color: C.textSecondary }]}>
            Tap "Where to?" to request a pickup
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 20 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  greeting: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  notifBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 50,
    borderWidth: 1.5,
    height: 52,
    paddingHorizontal: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  searchText: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  quickList: {
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  quickRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  quickIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  quickInfo: { flex: 1 },
  quickLabel: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  quickSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  divider: { height: 1, marginLeft: 68 },
  section: { gap: 14 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
  demoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  demoBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  mapCard: {
    borderRadius: 20,
    overflow: "hidden",
    height: 200,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  mapImage: {
    width: "100%",
    height: "100%",
  },
  mapPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  mapPlaceholderText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  mapBadge: {
    position: "absolute",
    bottom: 14,
    left: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  mapBadgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#22C55E",
  },
  mapBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  emptyCard: {
    borderRadius: 20,
    padding: 40,
    alignItems: "center",
    gap: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    marginTop: 6,
  },
  emptySub: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
});
