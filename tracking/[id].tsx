import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Animated,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
  Easing,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/context/ThemeContext";
import { useUser, authedFetch } from "@/context/UserContext";

type TrackingData = {
  deliveryId: string;
  status: string;
  courierLat: number | null;
  courierLng: number | null;
  courierName: string | null;
  lastUpdated: string | null;
};

type DeliveryData = {
  pickupAddress: string;
  dropoffAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  packageDescription: string;
  estimatedPrice: number;
  courier?: { name: string; rating?: number | null } | null;
  createdAt?: string;
  dropoffPhotoUrl?: string | null;
  senderPhotoUrl?: string | null;
  deliveryType?: string | null;
  pickupCode?: string | null;
  porterBoxName?: string | null;
};

type StatusInfo = {
  title: string;
  hint: string;
  filledSegments: number;
};

const TOTAL_SEGMENTS = 4;
const NEAR_THRESHOLD_KM = 0.5;

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const JUST_PICKED_UP_WINDOW_MS = 90_000;

function getStatusInfo(
  status: string,
  tracking: TrackingData | null,
  delivery: DeliveryData | null,
  courierName: string | null
): StatusInfo {
  const firstName = courierName ? courierName.split(" ")[0] : "Your porter";
  const cLat = tracking?.courierLat;
  const cLng = tracking?.courierLng;
  const hasCourierPos = cLat != null && cLng != null;

  if (status === "accepted") {
    const isNearPickup =
      hasCourierPos &&
      delivery != null &&
      haversineKm(cLat!, cLng!, delivery.pickupLat, delivery.pickupLng) <
        NEAR_THRESHOLD_KM;

    if (delivery?.deliveryType === "box_dropoff") {
      if (isNearPickup) {
        return {
          title: "Porter is at the box",
          hint: `${firstName} is collecting your package now`,
          filledSegments: 2,
        };
      }
      return {
        title: "Porter heading to the box",
        hint: `${firstName} is on the way to ${delivery.porterBoxName ?? "the Porter Box"}`,
        filledSegments: 2,
      };
    }

    if (isNearPickup) {
      return {
        title: "Arriving now…",
        hint: "Be ready — your porter is almost at the door",
        filledSegments: 1,
      };
    }
    return {
      title: "On the way…",
      hint: "Have your packages ready for easy pickup",
      filledSegments: 1,
    };
  }

  if (status === "picked_up") {
    const lastUpdatedMs = tracking?.lastUpdated
      ? new Date(tracking.lastUpdated).getTime()
      : null;
    const justPickedUp =
      lastUpdatedMs != null &&
      Date.now() - lastUpdatedMs < JUST_PICKED_UP_WINDOW_MS;

    const isNearDropoff =
      hasCourierPos &&
      delivery != null &&
      haversineKm(
        cLat!,
        cLng!,
        delivery.dropoffLat,
        delivery.dropoffLng
      ) < NEAR_THRESHOLD_KM;

    if (delivery?.deliveryType === "box_dropoff") {
      if (isNearDropoff) {
        return {
          title: "Dropping off",
          hint: "Your package is almost at the destination",
          filledSegments: 3,
        };
      }
      if (justPickedUp) {
        return {
          title: "Package collected!",
          hint: `${firstName} picked up your package from the box`,
          filledSegments: 3,
        };
      }
      return {
        title: "On the way to deliver",
        hint: `${firstName} collected your package and is heading to the recipient`,
        filledSegments: 3,
      };
    }

    if (justPickedUp) {
      return {
        title: "Arrived!",
        hint: `${firstName} has collected your packages`,
        filledSegments: 2,
      };
    }

    if (isNearDropoff) {
      return {
        title: "Dropping off",
        hint: "Your package is almost at the destination",
        filledSegments: 3,
      };
    }
    return {
      title: "Heading to dropoff location",
      hint: `${firstName} picked up your packages and is on the way`,
      filledSegments: 2,
    };
  }

  if (status === "in_box") {
    return {
      title: "Package Deposited!",
      hint: "Your package is in the box — a porter will collect it shortly",
      filledSegments: 2,
    };
  }

  if (status === "delivered") {
    return {
      title: "Delivered!",
      hint: "Your package has arrived safely",
      filledSegments: 4,
    };
  }

  if (status === "cancelled") {
    return {
      title: "Delivery Cancelled",
      hint: "This delivery was cancelled",
      filledSegments: 0,
    };
  }

  if (delivery?.deliveryType === "box_dropoff") {
    return {
      title: `Bring your package to ${delivery.porterBoxName ?? "the Porter Box"}`,
      hint: "Use your drop-off code to open the box",
      filledSegments: 1,
    };
  }

  return {
    title: "Finding your porter…",
    hint: "Sit tight — a porter will accept shortly",
    filledSegments: 1,
  };
}

function formatEtaTime(minutes: number): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + minutes);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function TrackingScreen() {
  const insets = useSafeAreaInsets();
  const C = useColors();
  const { token } = useUser();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isWeb = Platform.OS === "web";

  const [tracking, setTracking] = useState<TrackingData | null>(null);
  const [delivery, setDelivery] = useState<DeliveryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [MapView, setMapView] = useState<any>(null);
  const [Marker, setMarker] = useState<any>(null);
  const [Polyline, setPolyline] = useState<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [photoLightbox, setPhotoLightbox] = useState<string | null>(null);
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const courierLat = useRef(new Animated.Value(0)).current;
  const courierLng = useRef(new Animated.Value(0)).current;
  const prevCoords = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!isWeb) {
      import("react-native-maps")
        .then((mod) => {
          setMapView(() => mod.default);
          setMarker(() => mod.Marker);
          setPolyline(() => mod.Polyline);
          setMapReady(true);
        })
        .catch(() => setMapReady(false));
    }
  }, [isWeb]);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.4,
          duration: 900,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  const fetchDelivery = useCallback(async () => {
    if (!id) return;
    try {
      const res = await authedFetch(
        token,
        `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/deliveries/${id}`
      );
      if (res.ok) setDelivery(await res.json());
    } catch {}
  }, [id, token]);

  const fetchTracking = useCallback(async () => {
    if (!id) return;
    try {
      const res = await authedFetch(
        token,
        `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/tracking/${id}`
      );
      if (!res.ok) return;
      const data: TrackingData = await res.json();
      setTracking(data);

      if (data.courierLat != null && data.courierLng != null) {
        if (!prevCoords.current) {
          courierLat.setValue(data.courierLat);
          courierLng.setValue(data.courierLng);
        } else {
          Animated.parallel([
            Animated.timing(courierLat, {
              toValue: data.courierLat,
              duration: 1500,
              useNativeDriver: false,
            }),
            Animated.timing(courierLng, {
              toValue: data.courierLng,
              duration: 1500,
              useNativeDriver: false,
            }),
          ]).start();
        }
        prevCoords.current = { lat: data.courierLat, lng: data.courierLng };
      }
    } catch {}
  }, [id]);

  useEffect(() => {
    Promise.all([fetchDelivery(), fetchTracking()]).finally(() =>
      setLoading(false)
    );
    const interval = setInterval(fetchTracking, 3500);
    return () => clearInterval(interval);
  }, [fetchDelivery, fetchTracking]);

  useEffect(() => {
    if (!delivery) return;
    const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;
    const { pickupLng, pickupLat, dropoffLng, dropoffLat } = delivery;
    fetch(
      `https://api.mapbox.com/directions/v5/mapbox/driving/${pickupLng},${pickupLat};${dropoffLng},${dropoffLat}?geometries=geojson&overview=full&access_token=${token}`
    )
      .then((r) => r.json())
      .then((data) => {
        const coords: [number, number][] =
          data?.routes?.[0]?.geometry?.coordinates ?? [];
        if (coords.length > 0) {
          setRouteCoords(
            coords.map(([lng, lat]) => ({ latitude: lat, longitude: lng }))
          );
        }
      })
      .catch(() => {});
  }, [delivery?.pickupLat, delivery?.dropoffLat]);

  const etaMinutes = (() => {
    if (
      !tracking?.courierLat ||
      !tracking?.courierLng ||
      !delivery ||
      tracking.status === "delivered"
    )
      return null;
    const R = 6371;
    const dLat =
      ((delivery.dropoffLat - tracking.courierLat) * Math.PI) / 180;
    const dLon =
      ((delivery.dropoffLng - tracking.courierLng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((tracking.courierLat * Math.PI) / 180) *
        Math.cos((delivery.dropoffLat * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.max(1, Math.round(distKm * 3 + 2));
  })();

  const currentStatus = tracking?.status ?? "pending";
  const courierName =
    tracking?.courierName ?? delivery?.courier?.name ?? null;
  const statusInfo = getStatusInfo(currentStatus, tracking, delivery, courierName);

  const etaLine = (() => {
    if (currentStatus === "delivered") {
      const ts = tracking?.lastUpdated ?? delivery?.createdAt;
      if (ts) {
        const t = new Date(ts);
        return `Delivery time: ${t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
      }
      return "Delivered";
    }
    if (currentStatus === "pending") return "Matching you with a Porter";
    if (currentStatus === "cancelled") return "";
    if (etaMinutes != null)
      return `Estimated Arrival: ${formatEtaTime(etaMinutes)}`;
    return "Calculating arrival time…";
  })();

  const courierInitial = courierName ? courierName.charAt(0).toUpperCase() : "P";
  const displayName = courierName ?? "Your porter";
  const vehicleDetail = "Vehicle info not available";

  if (loading) {
    return (
      <View style={[ss.center, { backgroundColor: C.background }]}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={[ss.screen, { backgroundColor: C.background }]}>
      <View style={[ss.topPanel, { backgroundColor: C.surface, paddingTop: insets.top + 10 }]}>
        <View style={ss.topRow}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              ss.iconBtn,
              { backgroundColor: C.surfaceSecondary, opacity: pressed ? 0.7 : 1 },
            ]}
            hitSlop={12}
          >
            <Feather name="x" size={20} color={C.text} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable
            style={({ pressed }) => [
              ss.helpBtn,
              { borderColor: C.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[ss.helpBtnText, { color: C.text }]}>Help</Text>
          </Pressable>
        </View>

        <Text style={[ss.statusTitle, { color: C.text }]}>
          {statusInfo.title}
        </Text>

        {etaLine ? (
          <Text style={[ss.etaLine, { color: C.textSecondary }]}>{etaLine}</Text>
        ) : null}

        <View style={ss.progressRow}>
          {Array.from({ length: TOTAL_SEGMENTS }).map((_, i) => (
            <View
              key={i}
              style={[
                ss.progressSegment,
                {
                  backgroundColor:
                    i < statusInfo.filledSegments ? C.primary : C.border,
                },
              ]}
            />
          ))}
        </View>

        {statusInfo.hint ? (
          <Text style={[ss.hintText, { color: C.textSecondary }]}>
            {statusInfo.hint}
          </Text>
        ) : null}
      </View>

      <View style={ss.mapArea}>
        {isWeb || !mapReady ? (
          <WebMapFallback
            delivery={delivery}
            tracking={tracking}
            pulseAnim={pulseAnim}
            C={C}
          />
        ) : (
          <NativeMap
            MapView={MapView}
            Marker={Marker}
            Polyline={Polyline}
            delivery={delivery}
            tracking={tracking}
            courierLat={courierLat}
            courierLng={courierLng}
            pulseAnim={pulseAnim}
            routeCoords={routeCoords}
          />
        )}
      </View>

      <View
        style={[
          ss.bottomCard,
          {
            backgroundColor: C.surface,
            borderTopColor: C.border,
            paddingBottom: insets.bottom + 16,
          },
        ]}
      >
        <View style={ss.dragIndicator} />

        <View style={ss.courierInfoRow}>
          <View style={[ss.courierAvatar, { backgroundColor: C.accent }]}>
            <Text style={ss.courierAvatarText}>{courierInitial}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[ss.courierName, { color: C.text }]}>{displayName}</Text>
            <Text style={[ss.courierVehicle, { color: C.textSecondary }]}>
              {vehicleDetail}
            </Text>
          </View>
          {delivery && (
            <Text style={[ss.priceText, { color: C.primary }]}>
              ${delivery.estimatedPrice.toFixed(2)}
            </Text>
          )}
        </View>

        {delivery?.deliveryType === "box_dropoff" && ["pending", "in_box"].includes(currentStatus) && (
          <View style={[ss.dropoffCodeCard, { backgroundColor: "#F5F0FF", borderColor: "#DDD6FE" }]}>
            <View style={ss.dropoffCodeHeader}>
              <Feather name="inbox" size={15} color="#7C3AED" />
              <Text style={[ss.dropoffCodeTitle, { color: "#7C3AED" }]}>
                {currentStatus === "in_box"
                  ? `Package in Box — ${delivery.porterBoxName ?? "Porter Box"}`
                  : `Drop-off at ${delivery.porterBoxName ?? "Porter Box"}`}
              </Text>
            </View>
            <Text style={[ss.dropoffCodeHint, { color: "#6D28D9" }]}>
              {currentStatus === "in_box"
                ? "Your package is deposited. A porter will collect it using this code:"
                : "Bring your package to the box. Use this code to open it:"}
            </Text>
            {delivery.pickupCode ? (
              <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
                {delivery.pickupCode.split("").map((char, i) => (
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
            ) : (
              <Text style={[ss.dropoffCodeHint, { color: "#7C3AED", marginTop: 4 }]}>Code will appear after payment</Text>
            )}
            <Text style={[ss.dropoffCodeHint, { color: "#9CA3AF", marginTop: 6 }]}>
              {delivery.pickupAddress}
            </Text>
          </View>
        )}

        {currentStatus === "delivered" && delivery?.dropoffPhotoUrl ? (
          <Pressable
            style={[ss.deliveredPhotoCard, { backgroundColor: C.surfaceSecondary, borderColor: C.border }]}
            onPress={() => setPhotoLightbox(delivery.dropoffPhotoUrl!)}
            accessibilityLabel="View drop-off photo"
          >
            <View style={ss.deliveredPhotoHeader}>
              <Feather name="check-circle" size={14} color="#10B981" />
              <Text style={[ss.deliveredPhotoLabel, { color: "#10B981" }]}>Drop-off photo</Text>
              <Feather name="maximize-2" size={12} color={C.textSecondary} style={{ marginLeft: "auto" }} />
            </View>
            <Image
              source={{ uri: delivery.dropoffPhotoUrl }}
              style={ss.deliveredPhoto}
              resizeMode="cover"
            />
          </Pressable>
        ) : null}

        <Modal
          visible={!!photoLightbox}
          transparent
          animationType="fade"
          onRequestClose={() => setPhotoLightbox(null)}
        >
          <Pressable
            style={ss.lightboxOverlay}
            onPress={() => setPhotoLightbox(null)}
          >
            <Image
              source={{ uri: photoLightbox ?? "" }}
              style={ss.lightboxImage}
              resizeMode="contain"
            />
            <Pressable
              style={[ss.lightboxClose, { backgroundColor: C.surface }]}
              onPress={() => setPhotoLightbox(null)}
            >
              <Feather name="x" size={22} color={C.text} />
            </Pressable>
          </Pressable>
        </Modal>

        <View
          style={[
            ss.messageRow,
            { backgroundColor: C.surfaceSecondary, borderColor: C.border },
          ]}
        >
          <Feather name="phone" size={18} color={C.textTertiary} />
          <TextInput
            style={[ss.messageInput, { color: C.text }]}
            placeholder="Send them a message…"
            placeholderTextColor={C.textTertiary}
            editable={false}
            pointerEvents="none"
          />
          <Pressable hitSlop={12}>
            <Feather name="send" size={16} color={C.textTertiary} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function NativeMap({
  MapView,
  Marker,
  Polyline,
  delivery,
  tracking,
  courierLat,
  courierLng,
  pulseAnim,
  routeCoords,
}: any) {
  if (!delivery || !MapView) return null;

  const region = {
    latitude: (delivery.pickupLat + delivery.dropoffLat) / 2,
    longitude: (delivery.pickupLng + delivery.dropoffLng) / 2,
    latitudeDelta:
      Math.abs(delivery.pickupLat - delivery.dropoffLat) * 2 + 0.02,
    longitudeDelta:
      Math.abs(delivery.pickupLng - delivery.dropoffLng) * 2 + 0.02,
  };

  const hasCourier =
    tracking?.courierLat != null && tracking?.courierLng != null;

  const fallbackRoute = [
    { latitude: delivery.pickupLat, longitude: delivery.pickupLng },
    { latitude: delivery.dropoffLat, longitude: delivery.dropoffLng },
  ];
  const polylineCoords =
    routeCoords && routeCoords.length > 1 ? routeCoords : fallbackRoute;

  return (
    <MapView
      style={StyleSheet.absoluteFill}
      initialRegion={region}
      mapType="mutedStandard"
      showsUserLocation={false}
      showsPointsOfInterest={false}
    >
      {/* Road route line */}
      <Polyline
        coordinates={polylineCoords}
        strokeColor="#123E6B"
        strokeWidth={4}
        lineJoin="round"
      />

      {/* Pickup marker */}
      <Marker
        coordinate={{
          latitude: delivery.pickupLat,
          longitude: delivery.pickupLng,
        }}
        title="Pickup"
        pinColor="#123E6B"
      />

      {/* Dropoff marker */}
      <Marker
        coordinate={{
          latitude: delivery.dropoffLat,
          longitude: delivery.dropoffLng,
        }}
        title="Drop-off"
        pinColor="#EF4444"
      />

      {/* Animated courier marker */}
      {hasCourier && (
        <Marker.Animated
          coordinate={{
            latitude: courierLat,
            longitude: courierLng,
          }}
          title={tracking.courierName ?? "Courier"}
        >
          <View style={ss.courierMarker}>
            <Animated.View
              style={[
                ss.courierPulse,
                { transform: [{ scale: pulseAnim }] },
              ]}
            />
            <View style={ss.courierDot}>
              <Feather name="truck" size={14} color="#fff" />
            </View>
          </View>
        </Marker.Animated>
      )}
    </MapView>
  );
}

function WebMapFallback({
  delivery,
  tracking,
  pulseAnim,
  C,
}: {
  delivery: DeliveryData | null;
  tracking: TrackingData | null;
  pulseAnim: Animated.Value;
  C: ReturnType<typeof useColors>;
}) {
  const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
  const staticMapUrl =
    delivery && MAPBOX_TOKEN
      ? buildStaticMapUrl(delivery, tracking, MAPBOX_TOKEN)
      : null;

  return (
    <View style={[ss.webMapContainer, { backgroundColor: C.surfaceSecondary }]}>
      {staticMapUrl ? (
        <Image
          source={{ uri: staticMapUrl }}
          style={ss.webMapImage}
          resizeMode="cover"
        />
      ) : (
        <View style={[ss.webMapPlaceholder, { backgroundColor: C.surfaceSecondary }]}>
          <Feather name="map" size={48} color={C.border} />
          <Text style={[ss.webMapPlaceholderText, { color: C.textTertiary }]}>
            Map loading…
          </Text>
        </View>
      )}
    </View>
  );
}

function buildStaticMapUrl(
  delivery: DeliveryData,
  tracking: TrackingData | null,
  token: string
): string {
  const w = 750;
  const h = 460;

  const pickupMarker = `pin-l-p+123E6B(${delivery.pickupLng},${delivery.pickupLat})`;
  const dropoffMarker = `pin-l-p+6FA3C8(${delivery.dropoffLng},${delivery.dropoffLat})`;
  const markers: string[] = [pickupMarker, dropoffMarker];

  if (tracking?.courierLat != null && tracking?.courierLng != null) {
    markers.push(
      `pin-s-car+123E6B(${tracking.courierLng},${tracking.courierLat})`
    );
  }

  const markersStr = markers.join(",");
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${markersStr}/auto/${w}x${h}?access_token=${token}&padding=80,80,80,80&logo=false`;
}

const ss = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  topPanel: {
    paddingHorizontal: 20,
    paddingBottom: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 4,
    zIndex: 10,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  helpBtn: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  helpBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },

  statusTitle: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
    lineHeight: 32,
  },
  etaLine: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginBottom: 14,
    lineHeight: 20,
  },

  progressRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 12,
  },
  progressSegment: {
    flex: 1,
    height: 6,
    borderRadius: 3,
  },

  hintText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },

  mapArea: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
  },

  bottomCard: {
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 12,
  },
  dragIndicator: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#DCE4EE",
    alignSelf: "center",
    marginBottom: 16,
  },
  courierInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 14,
  },
  courierAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  courierAvatarText: {
    color: "#fff",
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  courierName: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    lineHeight: 22,
  },
  courierVehicle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  priceText: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },

  deliveredPhotoCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    overflow: "hidden",
    gap: 0,
  },
  deliveredPhotoHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 10,
    paddingHorizontal: 12,
  },
  deliveredPhotoLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  deliveredPhoto: {
    width: "100%",
    height: 160,
  },
  lightboxOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  lightboxImage: {
    width: "100%",
    height: "80%",
  },
  lightboxClose: {
    position: "absolute",
    top: 56,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },

  messageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  messageInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },

  courierMarker: {
    alignItems: "center",
    justifyContent: "center",
    width: 50,
    height: 50,
  },
  courierPulse: {
    position: "absolute",
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(111,163,200,0.3)",
  },
  courierDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#123E6B",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: "#123E6B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 6,
  },

  webMapContainer: {
    flex: 1,
    overflow: "hidden",
  },
  webMapImage: {
    flex: 1,
    width: "100%",
  },
  webMapPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  webMapPlaceholderText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },

  dropoffCodeCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    marginBottom: 12,
    gap: 4,
  },
  dropoffCodeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  dropoffCodeTitle: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  dropoffCodeHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
});
