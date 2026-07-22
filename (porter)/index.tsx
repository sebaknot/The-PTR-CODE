import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import React, { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/context/ThemeContext";
import { useUser, authedFetch } from "@/context/UserContext";
import { DeliveryCard } from "@/components/DeliveryCard";

type Delivery = {
  id: string;
  status: string;
  packageSize: string;
  packageDescription: string;
  pickupAddress: string;
  dropoffAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  estimatedPrice: number;
  distanceKm?: number | null;
  sender?: { name: string; phone: string; rating?: number | null } | null;
  createdAt: string;
};

export default function PorterJobsScreen() {
  const insets = useSafeAreaInsets();
  const { user, token, setUser } = useUser();
  const C = useColors();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const [isOnline, setIsOnline] = useState(user?.isOnline ?? false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const requestLocation = useCallback(async (): Promise<{ lat: number; lng: number } | null> => {
    if (Platform.OS === "web") {
      return new Promise((resolve) => {
        if (typeof navigator !== "undefined" && "geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
              setLocation(loc);
              resolve(loc);
            },
            () => {
              const fallback = { lat: 40.7128, lng: -74.006 };
              setLocation(fallback);
              resolve(fallback);
            },
            { timeout: 5000 }
          );
        } else {
          const fallback = { lat: 40.7128, lng: -74.006 };
          setLocation(fallback);
          resolve(fallback);
        }
      });
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Location Required",
        "Enable location to see nearby delivery jobs."
      );
      return null;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    setLocation(loc);
    return loc;
  }, []);

  const fetchJobs = useCallback(async (loc?: { lat: number; lng: number }) => {
    const useLoc = loc ?? location;
    if (!useLoc) return;
    try {
      const res = await authedFetch(
        token,
        `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/deliveries/available?lat=${useLoc.lat}&lng=${useLoc.lng}&radiusKm=50`
      );
      const data = await res.json();
      setDeliveries(data.deliveries ?? []);
    } catch {}
  }, [location, token]);

  const updateLocation = useCallback(async (loc: { lat: number; lng: number }) => {
    if (!user?.id) return;
    try {
      await authedFetch(
        token,
        `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/porters/${user.id}/location`,
        { method: "PATCH", body: JSON.stringify(loc) }
      );
    } catch {}
  }, [user?.id, token]);

  useEffect(() => {
    requestLocation().then((loc) => {
      if (loc) fetchJobs(loc);
    });
  }, []);

  useEffect(() => {
    if (!isOnline || !location) return;
    const interval = setInterval(() => {
      updateLocation(location);
      fetchJobs(location);
    }, 15000);
    return () => clearInterval(interval);
  }, [isOnline, location, updateLocation, fetchJobs]);

  const toggleOnline = async (val: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsOnline(val);
    if (val) {
      const loc = await requestLocation();
      if (loc) {
        updateLocation(loc);
        fetchJobs(loc);
      }
    }
    if (user?.id) {
      try {
        const res = await authedFetch(
          token,
          `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/porters/${user.id}/availability`,
          { method: "PATCH", body: JSON.stringify({ isOnline: val }) }
        );
        const data = await res.json();
        if (user) setUser({ ...user, isOnline: data.isOnline });
      } catch {}
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    const loc = await requestLocation();
    if (loc) await fetchJobs(loc);
    setRefreshing(false);
  };

  const handleAccept = async (deliveryId: string) => {
    if (!user?.id) return;
    setAcceptingId(deliveryId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await authedFetch(
        token,
        `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/deliveries/${deliveryId}/accept`,
        { method: "POST", body: JSON.stringify({ courierId: user.id }) }
      );
      const data = await res.json();
      if (!res.ok) {
        Alert.alert("Already Taken", data.error || "This delivery is no longer available.");
        fetchJobs();
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setDeliveries((prev) => prev.filter((d) => d.id !== deliveryId));
      }
    } catch {
      Alert.alert("Error", "Could not accept delivery. Try again.");
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <View>
          <Text style={[styles.title, { color: C.text }]}>Available Jobs</Text>
          <Text style={[styles.subtitle, { color: C.textSecondary }]}>
            {isOnline ? `${deliveries.length} jobs nearby` : "Go online to see jobs"}
          </Text>
        </View>
        <View style={styles.onlineToggle}>
          <View
            style={[
              styles.onlineDot,
              { backgroundColor: isOnline ? C.success : C.textTertiary },
            ]}
          />
          <Text style={[styles.onlineLabel, { color: C.text }]}>
            {isOnline ? "Online" : "Offline"}
          </Text>
          <Switch
            value={isOnline}
            onValueChange={toggleOnline}
            trackColor={{ false: C.border, true: C.success }}
            thumbColor="#fff"
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 100 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={C.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {!isOnline ? (
          <View style={[styles.offlineCard, { backgroundColor: C.surface }]}>
            <View style={[styles.offlineIcon, { backgroundColor: C.surfaceSecondary }]}>
              <Feather name="wifi-off" size={36} color={C.textTertiary} />
            </View>
            <Text style={[styles.offlineTitle, { color: C.text }]}>You're Offline</Text>
            <Text style={[styles.offlineSub, { color: C.textSecondary }]}>
              Toggle online to start receiving delivery requests in your area
            </Text>
          </View>
        ) : loading ? (
          <ActivityIndicator color={C.accent} style={{ marginTop: 60 }} />
        ) : deliveries.length === 0 ? (
          <View style={[styles.offlineCard, { backgroundColor: C.surface }]}>
            <View style={[styles.offlineIcon, { backgroundColor: C.accentLight }]}>
              <Feather name="search" size={36} color={C.accent} />
            </View>
            <Text style={[styles.offlineTitle, { color: C.text }]}>No Jobs Nearby</Text>
            <Text style={[styles.offlineSub, { color: C.textSecondary }]}>
              We're looking for deliveries in your area. Pull to refresh.
            </Text>
          </View>
        ) : (
          deliveries.map((delivery) => (
            <View key={delivery.id}>
              <DeliveryCard
                delivery={delivery}
                role="courier"
                onPress={() => {}}
              />
              <Pressable
                style={({ pressed }) => [
                  styles.acceptBtn,
                  {
                    backgroundColor: C.accent,
                    opacity: pressed || acceptingId === delivery.id ? 0.85 : 1,
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                  },
                ]}
                onPress={() => handleAccept(delivery.id)}
                disabled={acceptingId === delivery.id}
              >
                {acceptingId === delivery.id ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Feather name="check-circle" size={18} color="#fff" />
                    <Text style={styles.acceptText}>
                      Accept — ${delivery.estimatedPrice.toFixed(2)}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 2 },
  onlineToggle: { flexDirection: "row", alignItems: "center", gap: 8 },
  onlineDot: { width: 8, height: 8, borderRadius: 4 },
  onlineLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  list: { paddingHorizontal: 20, paddingTop: 8, gap: 12 },
  offlineCard: {
    borderRadius: 24,
    padding: 40,
    alignItems: "center",
    gap: 16,
    marginTop: 20,
  },
  offlineIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  offlineTitle: { fontSize: 20, fontFamily: "Inter_600SemiBold" },
  offlineSub: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 280,
  },
  acceptBtn: {
    marginTop: -4,
    marginBottom: 4,
    borderRadius: 16,
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowColor: "#6FA3C8",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 5,
  },
  acceptText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
