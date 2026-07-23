import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useGetDelivery } from "@workspace/api-client-react";
import { useColors } from "@/context/ThemeContext";
import { useUser, authedFetch } from "@/context/UserContext";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { InteractiveMapModal } from "@/components/InteractiveMapModal";
import { PaymentBottomSheet } from "@/components/PaymentBottomSheet";
import { useStripeReady } from "@/components/StripeReadyContext";

type FeatherIconName = ComponentProps<typeof Feather>["name"];
type Step = "address" | "box-select" | "port-type" | "port-details" | "photo" | "delivery-method" | "finding-porter";
type SendMode = "pickup" | "drop-off";
type PortTypeId = "luggage" | "shopping" | "other";
type ServiceLevel = "priority" | "wait-save" | "porter-box";
type PackageSize = "small" | "medium" | "large" | "extra_large";

type PorterBox = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  distanceKm?: number | null;
};

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "";
const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? "";

const _routeCache = new Map<string, string>();

async function fetchMapboxRoute(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): Promise<string | null> {
  if (!MAPBOX_TOKEN) return null;
  const key = `${fromLat.toFixed(5)},${fromLng.toFixed(5)},${toLat.toFixed(5)},${toLng.toFixed(5)}`;
  if (_routeCache.has(key)) return _routeCache.get(key)!;
  try {
    const res = await fetch(
      `https://api.mapbox.com/directions/v5/mapbox/driving/${fromLng},${fromLat};${toLng},${toLat}?geometries=polyline&overview=full&access_token=${MAPBOX_TOKEN}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const encoded: string | undefined = data?.routes?.[0]?.geometry;
    if (encoded) {
      _routeCache.set(key, encoded);
      return encoded;
    }
  } catch {}
  return null;
}

const TAB_BAR_HEIGHT = Platform.select({ web: 84, ios: 49, android: 56 }) ?? 49;

const PORT_TYPE_OPTIONS: {
  id: PortTypeId;
  label: string;
  desc: string;
  icon: FeatherIconName;
}[] = [
  { id: "luggage", label: "Luggage", desc: "Suitcases, duffels, travel gear", icon: "briefcase" },
  { id: "shopping", label: "Shopping bags", desc: "Bags, boxes, parcels", icon: "shopping-bag" },
  { id: "other", label: "Something else", desc: "Anything that needs moving", icon: "package" },
];

const SIZE_TIERS: {
  id: PackageSize;
  label: string;
  sublabel: string;
  multiplier: number;
}[] = [
  { id: "extra_large", label: "Large", sublabel: "Luggage, boxes (10+ lbs)", multiplier: 2.0 },
  { id: "medium", label: "Standard", sublabel: "Shoe box, book (1–10 lbs)", multiplier: 1.3 },
  { id: "small", label: "Small", sublabel: "Envelope, phone (under 1 lb)", multiplier: 1.0 },
];

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

function calcPrice(km: number, multiplier: number): number {
  return Math.round((3.99 + km * 1.25) * multiplier * 100) / 100;
}

function getDominantMultiplier(
  largeCount: number,
  standardCount: number,
  smallCount: number
): number {
  if (largeCount > 0) return 2.0;
  if (standardCount > 0) return 1.3;
  return 1.0;
}

function getDominantPackageSize(
  largeCount: number,
  standardCount: number,
  smallCount: number
): PackageSize {
  if (largeCount > 0) return "extra_large";
  if (standardCount > 0) return "medium";
  return "small";
}

function buildStaticMapUrl(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
  w: number,
  h: number,
  routePolyline?: string | null
): string {
  const a = `pin-s-a+123E6B(${pickupLng.toFixed(5)},${pickupLat.toFixed(5)})`;
  const b = `pin-s-b+EF4444(${dropoffLng.toFixed(5)},${dropoffLat.toFixed(5)})`;
  const parts: string[] = [];
  if (routePolyline) {
    parts.push(`path-4+123E6B(${encodeURIComponent(routePolyline)})`);
  }
  parts.push(a, b);
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${parts.join(",")}/auto/${w}x${h}@2x?padding=60&access_token=${MAPBOX_TOKEN}`;
}

function buildPorterBoxMapUrl(
  boxes: { lat: number; lng: number; id: string }[],
  selectedId: string | null,
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number | null,
  dropoffLng: number | null,
  routePolyline: string | null,
  w: number,
  h: number
): string | null {
  if (!boxes.length || !MAPBOX_TOKEN) return null;
  const parts: string[] = [];
  if (routePolyline) {
    parts.push(`path-4+7C3AED(${encodeURIComponent(routePolyline)})`);
  }
  parts.push(`pin-s-a+123E6B(${pickupLng.toFixed(5)},${pickupLat.toFixed(5)})`);
  if (dropoffLat != null && dropoffLng != null) {
    parts.push(`pin-s-b+EF4444(${dropoffLng.toFixed(5)},${dropoffLat.toFixed(5)})`);
  }
  boxes.forEach((b, i) => {
    const color = b.id === selectedId ? "7C3AED" : "A78BFA";
    const label = i < 9
      ? String(i + 1)
      : String.fromCharCode("c".charCodeAt(0) + (i - 9));
    parts.push(`pin-s-${label}+${color}(${b.lng.toFixed(5)},${b.lat.toFixed(5)})`);
  });
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${parts.join(",")}/auto/${w}x${h}@2x?padding=60&access_token=${MAPBOX_TOKEN}`;
}

function buildSinglePinMapUrl(
  lat: number,
  lng: number,
  color: string,
  label: string,
  w: number,
  h: number
): string {
  const pin = `pin-s-${label}+${color}(${lng.toFixed(5)},${lat.toFixed(5)})`;
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${pin}/${lng.toFixed(4)},${lat.toFixed(4)},14/${w}x${h}@2x?access_token=${MAPBOX_TOKEN}`;
}

function StepHeader({
  onBack,
  onClose,
  title,
  subtitle,
}: {
  onBack?: () => void;
  onClose?: () => void;
  title: string;
  subtitle?: string;
}) {
  const C = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[ss.header, { paddingTop: insets.top + 12 }]}>
      <View style={ss.headerRow}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            style={({ pressed }) => [
              ss.headerBtn,
              { opacity: pressed ? 0.6 : 1, backgroundColor: C.surfaceSecondary },
            ]}
            hitSlop={12}
          >
            <Feather name="arrow-left" size={20} color={C.text} />
          </Pressable>
        ) : (
          <View style={ss.headerBtn} />
        )}
        <View style={ss.headerTitles}>
          <Text style={[ss.headerTitle, { color: C.text }]}>{title}</Text>
          {subtitle ? (
            <Text style={[ss.headerSub, { color: C.textSecondary }]}>{subtitle}</Text>
          ) : null}
        </View>
        {onClose ? (
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              ss.headerBtn,
              { opacity: pressed ? 0.6 : 1, backgroundColor: C.surfaceSecondary },
            ]}
            hitSlop={12}
          >
            <Feather name="x" size={20} color={C.text} />
          </Pressable>
        ) : (
          <View style={ss.headerBtn} />
        )}
      </View>
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const C = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        ss.primaryBtn,
        {
          backgroundColor: disabled ? C.border : C.primary,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={[ss.primaryBtnText, { color: disabled ? C.textSecondary : "#fff" }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function CounterRow({
  label,
  sublabel,
  count,
  onInc,
  onDec,
  isLast,
}: {
  label: string;
  sublabel: string;
  count: number;
  onInc: () => void;
  onDec: () => void;
  isLast?: boolean;
}) {
  const C = useColors();
  return (
    <View style={[ss.counterRow, !isLast && { borderBottomWidth: 1, borderBottomColor: C.border }]}>
      <View style={ss.counterInfo}>
        <Text style={[ss.counterLabel, { color: C.text }]}>{label}</Text>
        <Text style={[ss.counterSub, { color: C.textSecondary }]}>{sublabel}</Text>
      </View>
      <View style={ss.counterControls}>
        <Pressable
          onPress={() => {
            if (count > 0) {
              onDec();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
          }}
          style={({ pressed }) => [
            ss.counterBtn,
            {
              borderColor: C.border,
              backgroundColor: count === 0 ? C.surfaceSecondary : C.surface,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Feather name="minus" size={18} color={count === 0 ? C.textTertiary : C.text} />
        </Pressable>
        <Text style={[ss.counterValue, { color: C.text }]}>{count}</Text>
        <Pressable
          onPress={() => {
            onInc();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
          style={({ pressed }) => [
            ss.counterBtn,
            { borderColor: C.primary, backgroundColor: C.primaryLight, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="plus" size={18} color={C.primary} />
        </Pressable>
      </View>
    </View>
  );
}

export default function SenderPortsScreen() {
  const insets = useSafeAreaInsets();
  const { user, token } = useUser();
  const C = useColors();
  const params = useLocalSearchParams<{
    prefillDropoffAddress?: string;
    prefillDropoffLat?: string;
    prefillDropoffLng?: string;
    prefillMode?: string;
  }>();

  const [step, setStep] = useState<Step>("address");
  const [sendMode, setSendMode] = useState<SendMode>(
    params.prefillMode === "drop-off" ? "drop-off" : "pickup"
  );

  const [pickupAddress, setPickupAddress] = useState("");
  const [pickupLat, setPickupLat] = useState(0);
  const [pickupLng, setPickupLng] = useState(0);
  const [dropoffAddress, setDropoffAddress] = useState(params.prefillDropoffAddress ?? "");
  const [dropoffLat, setDropoffLat] = useState(
    params.prefillDropoffLat ? parseFloat(params.prefillDropoffLat) : 0
  );
  const [dropoffLng, setDropoffLng] = useState(
    params.prefillDropoffLng ? parseFloat(params.prefillDropoffLng) : 0
  );

  const [portType, setPortType] = useState<PortTypeId | null>(null);

  const [largeCount, setLargeCount] = useState(0);
  const [standardCount, setStandardCount] = useState(1);
  const [smallCount, setSmallCount] = useState(0);
  const [specialRequests, setSpecialRequests] = useState("");

  const [serviceLevel, setServiceLevel] = useState<ServiceLevel>("priority");
  const [showPayment, setShowPayment] = useState(false);
  const { stripeReady, stripeError } = useStripeReady();

  const [porterBoxes, setPorterBoxes] = useState<PorterBox[]>([]);
  const [porterBoxesLoading, setPorterBoxesLoading] = useState(false);
  const [selectedPorterBox, setSelectedPorterBox] = useState<PorterBox | null>(null);

  const [dropoffBox, setDropoffBox] = useState<PorterBox | null>(null);
  const [dropoffBoxes, setDropoffBoxes] = useState<PorterBox[]>([]);
  const [dropoffBoxesLoading, setDropoffBoxesLoading] = useState(false);
  const [dropoffBoxRoutePolyline, setDropoffBoxRoutePolyline] = useState<string | null>(null);

  const [deliveryRoutePolyline, setDeliveryRoutePolyline] = useState<string | null>(null);
  const [boxRoutePolyline, setBoxRoutePolyline] = useState<string | null>(null);

  const [mapModalVisible, setMapModalVisible] = useState(false);
  const [mapModalContext, setMapModalContext] = useState<"route" | "porter-boxes" | "dropoff-boxes">("route");

  const [packagePhotoUri, setPackagePhotoUri] = useState<string | null>(null);
  const [senderPhotoUrl, setSenderPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [gpsLoading, setGpsLoading] = useState(false);
  const pickupManuallySet = useRef(false);

  const [findingDeliveryId, setFindingDeliveryId] = useState<string | null>(null);

  const { data: findingDelivery } = useGetDelivery(findingDeliveryId ?? "", {
    query: { enabled: !!findingDeliveryId, refetchInterval: 3000 },
  });

  useEffect(() => {
    if (!findingDelivery || !findingDeliveryId) return;
    if (findingDelivery.status !== "pending") {
      router.replace({ pathname: "/delivery/[id]", params: { id: findingDeliveryId } });
    }
  }, [findingDelivery?.status, findingDeliveryId]);

  useEffect(() => {
    if (params.prefillDropoffAddress) {
      setDropoffAddress(params.prefillDropoffAddress);
      setDropoffLat(params.prefillDropoffLat ? parseFloat(params.prefillDropoffLat) : 0);
      setDropoffLng(params.prefillDropoffLng ? parseFloat(params.prefillDropoffLng) : 0);
      setStep("address");
    }
  }, [params.prefillDropoffAddress]);

  useEffect(() => {
    if (pickupAddress) return;
    setGpsLoading(true);
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") return;
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const { latitude, longitude } = loc.coords;
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude.toFixed(6)},${latitude.toFixed(6)}.json?types=address,place&limit=1&access_token=${MAPBOX_TOKEN}`
        );
        const data = await res.json();
        const feature = data.features?.[0];
        if (feature && !pickupManuallySet.current) {
          setPickupAddress(feature.place_name);
          setPickupLat(latitude);
          setPickupLng(longitude);
        }
      } catch {}
      finally {
        setGpsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!pickupAddress || pickupLat === 0 || !dropoffAddress || dropoffLat === 0 || !MAPBOX_TOKEN) return;
    setDeliveryRoutePolyline(null);
    let cancelled = false;
    fetchMapboxRoute(pickupLat, pickupLng, dropoffLat, dropoffLng)
      .then((poly) => { if (!cancelled && poly) setDeliveryRoutePolyline(poly); });
    return () => { cancelled = true; };
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng, pickupAddress, dropoffAddress]);

  useEffect(() => {
    if (!selectedPorterBox) {
      setBoxRoutePolyline(null);
      return;
    }
    if (!pickupAddress || pickupLat === 0 || !MAPBOX_TOKEN) return;
    setBoxRoutePolyline(null);
    let cancelled = false;
    fetchMapboxRoute(pickupLat, pickupLng, selectedPorterBox.lat, selectedPorterBox.lng)
      .then((poly) => { if (!cancelled && poly) setBoxRoutePolyline(poly); });
    return () => { cancelled = true; };
  }, [pickupLat, pickupLng, selectedPorterBox?.id, selectedPorterBox, pickupAddress]);

  useEffect(() => {
    if (serviceLevel !== "porter-box") return;
    if (!pickupLat || !pickupLng) return;
    setPorterBoxesLoading(true);
    setPorterBoxes([]);
    setSelectedPorterBox(null);
    const lat = pickupLat;
    const lng = pickupLng;
    const dropParams = dropoffReady
      ? `&dropoffLat=${dropoffLat}&dropoffLng=${dropoffLng}`
      : "";
    authedFetch(
      token,
      `https://${DOMAIN}/api/porter-boxes?lat=${lat}&lng=${lng}${dropParams}`
    )
      .then((r) => r.json())
      .then((d) => {
        const boxes: PorterBox[] = d.boxes ?? [];
        setPorterBoxes(boxes);
        if (boxes.length > 0) {
          setSelectedPorterBox(boxes[0]);
        }
      })
      .catch(() => {})
      .finally(() => setPorterBoxesLoading(false));
  }, [serviceLevel, token, pickupLat, pickupLng, dropoffLat, dropoffLng]);

  useEffect(() => {
    if (step !== "box-select") return;
    if (!dropoffLat || !dropoffLng) return;
    setDropoffBoxesLoading(true);
    setDropoffBoxes([]);
    authedFetch(
      token,
      `https://${DOMAIN}/api/porter-boxes?lat=${dropoffLat}&lng=${dropoffLng}`
    )
      .then((r) => r.json())
      .then((d) => {
        const boxes: PorterBox[] = d.boxes ?? [];
        setDropoffBoxes(boxes);
        if (boxes.length > 0 && !dropoffBox) {
          setDropoffBox(boxes[0]);
        }
      })
      .catch(() => {})
      .finally(() => setDropoffBoxesLoading(false));
  }, [step, token, dropoffLat, dropoffLng]);

  useEffect(() => {
    if (!dropoffBox || sendMode !== "drop-off") {
      setDropoffBoxRoutePolyline(null);
      return;
    }
    if (!dropoffLat || !MAPBOX_TOKEN) return;
    setDropoffBoxRoutePolyline(null);
    let cancelled = false;
    fetchMapboxRoute(dropoffBox.lat, dropoffBox.lng, dropoffLat, dropoffLng)
      .then((poly) => { if (!cancelled && poly) setDropoffBoxRoutePolyline(poly); });
    return () => { cancelled = true; };
  }, [dropoffBox?.id, sendMode, dropoffLat, dropoffLng]);

  const effectiveDropoff = serviceLevel === "porter-box" && selectedPorterBox
    ? { address: selectedPorterBox.address, lat: selectedPorterBox.lat, lng: selectedPorterBox.lng }
    : { address: dropoffAddress, lat: dropoffLat, lng: dropoffLng };

  const distanceKm = sendMode === "drop-off" && dropoffBox && dropoffLat
    ? haversineKm(dropoffBox.lat, dropoffBox.lng, dropoffLat, dropoffLng)
    : (pickupLat && effectiveDropoff.lat
      ? haversineKm(pickupLat, pickupLng, effectiveDropoff.lat, effectiveDropoff.lng)
      : 3.2);

  const sizeMultiplier = getDominantMultiplier(largeCount, standardCount, smallCount);
  const basePrice = calcPrice(distanceKm, sizeMultiplier);
  const finalPrice = sendMode === "drop-off"
    ? Math.round(basePrice * 0.85 * 100) / 100
    : (serviceLevel === "wait-save" ? Math.round(basePrice * 0.85 * 100) / 100 : basePrice);
  const packageSize = getDominantPackageSize(largeCount, standardCount, smallCount);
  const totalItems = largeCount + standardCount + smallCount;
  const pickupReady = !!pickupAddress && pickupLat !== 0;
  const dropoffReady = !!dropoffAddress && dropoffLat !== 0;

  const descParts: string[] = [];
  if (largeCount > 0) descParts.push(`Large: ${largeCount}`);
  if (standardCount > 0) descParts.push(`Standard: ${standardCount}`);
  if (smallCount > 0) descParts.push(`Small: ${smallCount}`);
  const portTypeLabel = PORT_TYPE_OPTIONS.find((p) => p.id === portType)?.label ?? "Package";
  const packageDescription = `${portTypeLabel}${descParts.length ? ` — ${descParts.join(", ")}` : ""}`;

  const isPorterBox = serviceLevel === "porter-box";
  const porterBoxReady = !isPorterBox || selectedPorterBox != null;

  const deliveryData = sendMode === "drop-off"
    ? {
        packageSize,
        packageDescription,
        pickupAddress: dropoffBox?.address ?? "",
        pickupLat: dropoffBox?.lat ?? 0,
        pickupLng: dropoffBox?.lng ?? 0,
        dropoffAddress,
        dropoffLat,
        dropoffLng,
        notes: specialRequests || undefined,
        deliveryType: "box_dropoff" as "box_dropoff",
        porterBoxId: dropoffBox?.id ?? undefined,
        senderPhotoUrl: senderPhotoUrl ?? undefined,
      }
    : {
        packageSize,
        packageDescription,
        pickupAddress,
        pickupLat,
        pickupLng,
        dropoffAddress: effectiveDropoff.address,
        dropoffLat: effectiveDropoff.lat,
        dropoffLng: effectiveDropoff.lng,
        notes: specialRequests || undefined,
        deliveryType: (isPorterBox ? "porter_box" : "standard") as "standard" | "porter_box",
        porterBoxId: isPorterBox ? (selectedPorterBox?.id ?? undefined) : undefined,
        senderPhotoUrl: senderPhotoUrl ?? undefined,
      };

  const handleClose = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.navigate("/(sender)");
    }
  }, []);

  const handlePaymentSuccess = useCallback(async (deliveryId: string) => {
    setFindingDeliveryId(deliveryId);
    setStep("finding-porter");
  }, []);

  const [devBypassing, setDevBypassing] = useState(false);
  const handleDevBypass = useCallback(async () => {
    if (devBypassing) return;
    setDevBypassing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await fetch(`https://${DOMAIN}/api/payments/dev-bypass`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ deliveryData }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Dev bypass failed");
      handlePaymentSuccess(data.delivery.id);
    } catch (e) {
      Alert.alert("Dev bypass error", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setDevBypassing(false);
    }
  }, [devBypassing, token, deliveryData, handlePaymentSuccess]);

  const mapModalNode = (
    <InteractiveMapModal
      visible={mapModalVisible}
      onClose={() => setMapModalVisible(false)}
      title={
        mapModalContext === "porter-boxes"
          ? "Porter Boxes"
          : mapModalContext === "dropoff-boxes"
          ? "Drop-off Boxes"
          : "Route"
      }
      pickupLat={mapModalContext === "dropoff-boxes" ? null : (pickupLat || null)}
      pickupLng={mapModalContext === "dropoff-boxes" ? null : (pickupLng || null)}
      dropoffLat={
        mapModalContext === "porter-boxes"
          ? null
          : mapModalContext === "dropoff-boxes"
          ? (dropoffLat || null)
          : (dropoffLat || null)
      }
      dropoffLng={
        mapModalContext === "porter-boxes"
          ? null
          : mapModalContext === "dropoff-boxes"
          ? (dropoffLng || null)
          : (dropoffLng || null)
      }
      routePolyline={
        mapModalContext === "porter-boxes"
          ? boxRoutePolyline
          : mapModalContext === "dropoff-boxes"
          ? dropoffBoxRoutePolyline
          : deliveryRoutePolyline
      }
      routeColor={
        mapModalContext === "porter-boxes" || mapModalContext === "dropoff-boxes"
          ? "#7C3AED"
          : "#123E6B"
      }
      porterBoxes={
        mapModalContext === "porter-boxes"
          ? porterBoxes
          : mapModalContext === "dropoff-boxes"
          ? dropoffBoxes
          : undefined
      }
      selectedPorterBoxId={
        mapModalContext === "dropoff-boxes"
          ? dropoffBox?.id
          : selectedPorterBox?.id
      }
      onSelectPorterBox={
        mapModalContext === "porter-boxes"
          ? (box) => setSelectedPorterBox(box)
          : mapModalContext === "dropoff-boxes"
          ? (box) => { setDropoffBox(box); setMapModalVisible(false); }
          : undefined
      }
    />
  );

  if (step === "address") {
    const addressMapUrl = (() => {
      if (sendMode === "drop-off") {
        if (dropoffLat) return buildSinglePinMapUrl(dropoffLat, dropoffLng, "EF4444", "b", 800, 320);
        return null;
      }
      if (pickupLat && dropoffLat) {
        return buildStaticMapUrl(pickupLat, pickupLng, dropoffLat, dropoffLng, 800, 320);
      }
      if (pickupLat) {
        return buildSinglePinMapUrl(pickupLat, pickupLng, "123E6B", "a", 800, 320);
      }
      if (dropoffLat) {
        return buildSinglePinMapUrl(dropoffLat, dropoffLng, "EF4444", "b", 800, 320);
      }
      return null;
    })();

    const nextEnabled = sendMode === "drop-off" ? dropoffReady : (pickupReady && dropoffReady);

    return (
      <View style={[ss.screen, { backgroundColor: C.background }]}>
        <StepHeader title="Where to?" onClose={handleClose} />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          {/* Mode selector */}
          <View style={[ss.modeSelectorRow, { paddingHorizontal: 16, paddingBottom: 10, paddingTop: 2 }]}>
            <Pressable
              onPress={() => setSendMode("pickup")}
              style={[
                ss.modeSelectorBtn,
                sendMode === "pickup"
                  ? { backgroundColor: C.primary }
                  : { backgroundColor: C.surfaceSecondary, borderColor: C.border },
              ]}
            >
              <Feather name="truck" size={14} color={sendMode === "pickup" ? "#fff" : C.textSecondary} />
              <Text style={[ss.modeSelectorText, { color: sendMode === "pickup" ? "#fff" : C.textSecondary }]}>
                Schedule Pickup
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setSendMode("drop-off")}
              style={[
                ss.modeSelectorBtn,
                sendMode === "drop-off"
                  ? { backgroundColor: "#7C3AED" }
                  : { backgroundColor: C.surfaceSecondary, borderColor: C.border },
              ]}
            >
              <Feather name="inbox" size={14} color={sendMode === "drop-off" ? "#fff" : C.textSecondary} />
              <Text style={[ss.modeSelectorText, { color: sendMode === "drop-off" ? "#fff" : C.textSecondary }]}>
                Drop Off at Box
              </Text>
            </Pressable>
          </View>

          {/* Address inputs sit OUTSIDE the ScrollView so dropdowns float freely */}
          <View style={[ss.addressCardOuter, { zIndex: 30 }]}>
            <View style={[ss.addressCard, { zIndex: 30, overflow: "visible" }]}>
              <View style={{ zIndex: 20, overflow: "visible" }}>
                <AddressAutocomplete
                  label={sendMode === "drop-off" ? "Recipient address" : "Where to?"}
                  placeholder="Enter delivery address"
                  value={dropoffAddress}
                  dotColor={C.error}
                  autoFocus={!dropoffAddress}
                  onSelect={(addr, lat, lng) => {
                    setDropoffAddress(addr);
                    setDropoffLat(lat);
                    setDropoffLng(lng);
                  }}
                />
              </View>
              {sendMode === "pickup" && (
                <>
                  <View style={[ss.addressDivider, { backgroundColor: C.border }]} />
                  <View style={{ zIndex: 10, overflow: "visible" }}>
                    <AddressAutocomplete
                      label="Pickup"
                      placeholder={gpsLoading ? "Detecting your location…" : "Enter pickup address"}
                      value={pickupAddress}
                      dotColor={C.primary}
                      onSelect={(addr, lat, lng) => {
                        pickupManuallySet.current = true;
                        setPickupAddress(addr);
                        setPickupLat(lat);
                        setPickupLng(lng);
                      }}
                    />
                  </View>
                </>
              )}
              {sendMode === "drop-off" && dropoffReady && (
                <View style={[ss.dropoffModeHint, { backgroundColor: "#F5F0FF", borderColor: "#DDD6FE" }]}>
                  <Feather name="inbox" size={13} color="#7C3AED" />
                  <Text style={[ss.dropoffModeHintText, { color: "#7C3AED" }]}>
                    You'll drop your package at a Porter Box near this address
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Scrollable section: map preview */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[ss.favoritesScrollContent, { paddingBottom: 16 }]}
            keyboardShouldPersistTaps="handled"
          >
            {addressMapUrl ? (
              <Pressable
                onPress={() => {
                  setMapModalContext("route");
                  setMapModalVisible(true);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                style={ss.mapPressable}
              >
                <Image
                  source={{ uri: addressMapUrl }}
                  style={ss.addressMapPreview}
                  contentFit="cover"
                />
                <View style={ss.mapExpandBadge} pointerEvents="none">
                  <Feather name="maximize-2" size={11} color="#fff" />
                  <Text style={ss.mapExpandText}>Tap to explore</Text>
                </View>
              </Pressable>
            ) : (
              <View style={[ss.addressMapPlaceholder, { backgroundColor: C.surfaceSecondary }]}>
                <Feather name="map" size={28} color={C.textTertiary} />
                <Text style={[ss.addressMapPlaceholderText, { color: C.textTertiary }]}>
                  {gpsLoading ? "Detecting location…" : "Enter an address to continue"}
                </Text>
              </View>
            )}
          </ScrollView>

          <View style={[ss.footer, { paddingBottom: insets.bottom + TAB_BAR_HEIGHT + 8, backgroundColor: C.background }]}>
            <PrimaryButton
              label={sendMode === "drop-off" ? "Choose a Porter Box" : "Next — Choose port type"}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                if (sendMode === "drop-off") {
                  setDropoffBox(null);
                  setDropoffBoxes([]);
                  setStep("box-select");
                } else {
                  setStep("port-type");
                }
              }}
              disabled={!nextEnabled}
            />
          </View>
        </KeyboardAvoidingView>
      {mapModalNode}
      </View>
    );
  }

  if (step === "box-select") {
    const dropoffBoxMapUrl = dropoffBoxes.length > 0
      ? buildPorterBoxMapUrl(
          dropoffBoxes,
          dropoffBox?.id ?? null,
          dropoffBox?.lat ?? dropoffLat,
          dropoffBox?.lng ?? dropoffLng,
          dropoffLat,
          dropoffLng,
          dropoffBoxRoutePolyline,
          800,
          280
        )
      : null;

    return (
      <View style={[ss.screen, { backgroundColor: C.background }]}>
        <StepHeader
          title="Choose a Porter Box"
          subtitle="Drop-off location"
          onBack={() => setStep("address")}
        />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[ss.detailsContent, { paddingBottom: 16, gap: 14 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[ss.stepHint, { color: C.textSecondary }]}>
            Pick the box nearest to{" "}
            <Text style={{ fontFamily: "Inter_600SemiBold", color: C.text }}>
              {dropoffAddress.split(",")[0]}
            </Text>
            . Your porter will collect from there and deliver to the recipient.
          </Text>

          {/* Destination summary */}
          <View style={[ss.dropoffDestCard, { backgroundColor: C.surface, borderColor: C.border }]}>
            <View style={[ss.routeDot, { backgroundColor: C.error, marginTop: 2 }]} />
            <View style={{ flex: 1 }}>
              <Text style={[ss.sectionLabel, { color: C.textSecondary, marginBottom: 1, marginTop: 0 }]}>Recipient address</Text>
              <Text style={[ss.routeAddr, { color: C.text }]} numberOfLines={2}>{dropoffAddress}</Text>
            </View>
          </View>

          {dropoffBoxesLoading ? (
            <View style={{ alignItems: "center", paddingVertical: 24 }}>
              <ActivityIndicator color="#7C3AED" size="large" />
              <Text style={[ss.boxSelectorEmpty, { color: C.textSecondary, marginTop: 8 }]}>Finding nearby boxes…</Text>
            </View>
          ) : dropoffBoxes.length === 0 ? (
            <Text style={[ss.boxSelectorEmpty, { color: C.textSecondary }]}>No boxes available nearby</Text>
          ) : (
            <>
              {dropoffBoxMapUrl ? (
                <Pressable
                  style={ss.mapPressable}
                  onPress={() => {
                    setMapModalContext("dropoff-boxes");
                    setMapModalVisible(true);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                >
                  <Image source={{ uri: dropoffBoxMapUrl }} style={ss.porterBoxMap} contentFit="cover" />
                  <View style={[ss.mapExpandHint, { backgroundColor: "rgba(124,58,237,0.85)" }]}>
                    <Feather name="maximize-2" size={13} color="#fff" />
                    <Text style={ss.mapExpandHintText}>Tap to select on map</Text>
                  </View>
                </Pressable>
              ) : null}
              {dropoffBoxes.map((box, idx) => {
                const isSelected = dropoffBox?.id === box.id;
                return (
                  <Pressable
                    key={box.id}
                    onPress={() => {
                      setDropoffBox(box);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    style={[
                      ss.dropoffBoxListCard,
                      {
                        borderColor: isSelected ? "#7C3AED" : C.border,
                        backgroundColor: isSelected ? "#F5F0FF" : C.surface,
                      },
                    ]}
                  >
                    <View style={[ss.boxCardNumBadge, { backgroundColor: isSelected ? "#7C3AED" : C.surfaceSecondary, marginBottom: 0 }]}>
                      <Text style={[ss.boxCardNumText, { color: isSelected ? "#fff" : C.textSecondary }]}>{idx + 1}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[ss.boxCardName, { color: C.text, fontSize: 15 }]}>{box.name}</Text>
                      <Text style={[ss.boxCardAddr, { color: C.textSecondary, fontSize: 12 }]} numberOfLines={2}>{box.address}</Text>
                      {box.distanceKm != null && (
                        <Text style={[ss.boxCardDist, { color: "#7C3AED" }]}>{(box.distanceKm * 0.621371).toFixed(1)} mi away</Text>
                      )}
                    </View>
                    <View style={[ss.serviceOptionRadio, {
                      borderColor: isSelected ? "#7C3AED" : C.border,
                      backgroundColor: isSelected ? "#7C3AED" : "transparent",
                    }]}>
                      {isSelected && <Feather name="check" size={12} color="#fff" />}
                    </View>
                  </Pressable>
                );
              })}
            </>
          )}
        </ScrollView>

        <View style={[ss.footer, { paddingBottom: insets.bottom + TAB_BAR_HEIGHT + 8, backgroundColor: C.background }]}>
          <PrimaryButton
            label="Next — What are you sending?"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setStep("port-type");
            }}
            disabled={!dropoffBox || dropoffBoxesLoading}
          />
        </View>
        {mapModalNode}
      </View>
    );
  }

  if (step === "port-type") {
    return (
      <View style={[ss.screen, { backgroundColor: C.background }]}>
        <StepHeader
          title="What are you sending?"
          subtitle="Step 2 of 4"
          onBack={() => setStep(sendMode === "drop-off" ? "box-select" : "address")}
        />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[ss.portTypeContent, { paddingBottom: 16 }]}
        >
          <Text style={[ss.stepHint, { color: C.textSecondary }]}>
            Choose the type that best describes your items
          </Text>
          {PORT_TYPE_OPTIONS.map((opt) => {
            const selected = portType === opt.id;
            return (
              <Pressable
                key={opt.id}
                style={({ pressed }) => [
                  ss.portTypeCard,
                  {
                    backgroundColor: selected ? C.primaryLight : C.surface,
                    borderColor: selected ? C.primary : C.border,
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                  },
                ]}
                onPress={() => {
                  setPortType(opt.id);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              >
                <View
                  style={[
                    ss.portTypeIconWrap,
                    { backgroundColor: selected ? C.primary : C.surfaceSecondary },
                  ]}
                >
                  <Feather name={opt.icon} size={26} color={selected ? "#fff" : C.text} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[ss.portTypeLabel, { color: selected ? C.primary : C.text }]}>
                    {opt.label}
                  </Text>
                  <Text style={[ss.portTypeDesc, { color: C.textSecondary }]}>{opt.desc}</Text>
                </View>
                <View
                  style={[
                    ss.portTypeRadio,
                    {
                      borderColor: selected ? C.primary : C.border,
                      backgroundColor: selected ? C.primary : "transparent",
                    },
                  ]}
                >
                  {selected && <Feather name="check" size={12} color="#fff" />}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={[ss.footer, { paddingBottom: insets.bottom + TAB_BAR_HEIGHT + 8, backgroundColor: C.background }]}>
          <PrimaryButton
            label="Next — Item details"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setStep("port-details");
            }}
            disabled={!portType}
          />
        </View>
      </View>
    );
  }

  if (step === "port-details") {
    return (
      <View style={[ss.screen, { backgroundColor: C.background }]}>
        <StepHeader
          title="Port details"
          subtitle="Step 3 of 4"
          onBack={() => setStep("port-type")}
        />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[ss.detailsContent, { paddingBottom: 16 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[ss.stepHint, { color: C.textSecondary }]}>
            How many items? We use this to price your port accurately.
          </Text>

          <View style={[ss.countersCard, { backgroundColor: C.surface, borderColor: C.border }]}>
            <CounterRow
              label="Large"
              sublabel="Luggage, boxes (10+ lbs)"
              count={largeCount}
              onInc={() => setLargeCount((n) => n + 1)}
              onDec={() => setLargeCount((n) => Math.max(0, n - 1))}
            />
            <CounterRow
              label="Standard"
              sublabel="Shoe box, book (1–10 lbs)"
              count={standardCount}
              onInc={() => setStandardCount((n) => n + 1)}
              onDec={() => setStandardCount((n) => Math.max(0, n - 1))}
            />
            <CounterRow
              label="Small"
              sublabel="Envelope, phone (under 1 lb)"
              count={smallCount}
              onInc={() => setSmallCount((n) => n + 1)}
              onDec={() => setSmallCount((n) => Math.max(0, n - 1))}
              isLast
            />
          </View>

          <Text style={[ss.sectionLabel, { color: C.textSecondary, marginTop: 20 }]}>
            Special requests (optional)
          </Text>
          <View style={[ss.textareaWrap, { backgroundColor: C.surface, borderColor: C.border }]}>
            <TextInput
              style={[ss.textarea, { color: C.text }]}
              placeholder="Fragile items, handle with care, elevator needed…"
              placeholderTextColor={C.textTertiary}
              multiline
              numberOfLines={4}
              value={specialRequests}
              onChangeText={setSpecialRequests}
              textAlignVertical="top"
            />
          </View>
        </ScrollView>

        <View style={[ss.footer, { paddingBottom: insets.bottom + TAB_BAR_HEIGHT + 8, backgroundColor: C.background }]}>
          <PrimaryButton
            label="Next — Add package photo"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setStep("photo");
            }}
            disabled={totalItems === 0}
          />
        </View>
      </View>
    );
  }

  if (step === "photo") {
    const uploadPhotoToStorage = async (uri: string) => {
      setUploadingPhoto(true);
      setSenderPhotoUrl(null);
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

        setSenderPhotoUrl(servingUrl);
      } catch (err) {
        Alert.alert("Upload failed", "Could not upload photo. Please try again.");
        setPackagePhotoUri(null);
      } finally {
        setUploadingPhoto(false);
      }
    };

    const launchCamera = async () => {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Camera permission required", "Please enable camera access in settings.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.6,
      });
      if (!result.canceled && result.assets[0]) {
        setPackagePhotoUri(result.assets[0].uri);
        setSenderPhotoUrl(null);
        await uploadPhotoToStorage(result.assets[0].uri);
      }
    };

    const launchGallery = async () => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Gallery permission required", "Please enable photo library access in settings.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.6,
      });
      if (!result.canceled && result.assets[0]) {
        setPackagePhotoUri(result.assets[0].uri);
        setSenderPhotoUrl(null);
        await uploadPhotoToStorage(result.assets[0].uri);
      }
    };

    return (
      <View style={[ss.screen, { backgroundColor: C.background }]}>
        <StepHeader
          title="Package photo"
          subtitle="Step 3.5 of 4 — Optional"
          onBack={() => setStep("port-details")}
        />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[ss.detailsContent, { paddingBottom: 24, gap: 20 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[ss.stepHint, { color: C.textSecondary }]}>
            Take a photo of your package so your porter can identify it at pickup.
          </Text>

          {packagePhotoUri ? (
            <View style={{ gap: 12 }}>
              <View style={{ position: "relative" }}>
                <Image
                  source={{ uri: packagePhotoUri }}
                  style={[ss.photoPreview, { borderColor: C.border }]}
                  contentFit="cover"
                />
                {uploadingPhoto && (
                  <View style={{
                    ...StyleSheet.absoluteFillObject,
                    backgroundColor: "rgba(0,0,0,0.45)",
                    borderRadius: 12,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}>
                    <ActivityIndicator color="#fff" size="large" />
                    <Text style={{ color: "#fff", fontSize: 13, fontFamily: "Inter_500Medium" }}>Uploading…</Text>
                  </View>
                )}
                {!uploadingPhoto && senderPhotoUrl && (
                  <View style={{
                    position: "absolute",
                    bottom: 10,
                    right: 10,
                    backgroundColor: "#22c55e",
                    borderRadius: 20,
                    padding: 5,
                  }}>
                    <Feather name="check" size={14} color="#fff" />
                  </View>
                )}
              </View>
              <Pressable
                onPress={() => { setPackagePhotoUri(null); setSenderPhotoUrl(null); }}
                style={({ pressed }) => [ss.photoRetakeBtn, { borderColor: C.border, opacity: pressed ? 0.7 : 1 }]}
                disabled={uploadingPhoto}
              >
                <Feather name="refresh-cw" size={16} color={C.textSecondary} />
                <Text style={[ss.photoRetakeTxt, { color: C.textSecondary }]}>Retake</Text>
              </Pressable>
            </View>
          ) : (
            <View style={ss.photoPickerRow}>
              <Pressable
                onPress={launchCamera}
                style={({ pressed }) => [
                  ss.photoPickerBtn,
                  { backgroundColor: C.primaryLight, borderColor: C.primary, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <View style={[ss.photoPickerIcon, { backgroundColor: C.primary }]}>
                  <Feather name="camera" size={28} color="#fff" />
                </View>
                <Text style={[ss.photoPickerLabel, { color: C.primary }]}>Take Photo</Text>
                <Text style={[ss.photoPickerSub, { color: C.textSecondary }]}>Use camera</Text>
              </Pressable>

              <Pressable
                onPress={launchGallery}
                style={({ pressed }) => [
                  ss.photoPickerBtn,
                  { backgroundColor: C.surface, borderColor: C.border, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <View style={[ss.photoPickerIcon, { backgroundColor: C.surfaceSecondary }]}>
                  <Feather name="image" size={28} color={C.textSecondary} />
                </View>
                <Text style={[ss.photoPickerLabel, { color: C.text }]}>From Gallery</Text>
                <Text style={[ss.photoPickerSub, { color: C.textSecondary }]}>Choose existing</Text>
              </Pressable>
            </View>
          )}

          <View style={[ss.photoBenefitCard, { backgroundColor: C.primaryLight, borderColor: C.primary }]}>
            <Feather name="info" size={16} color={C.primary} />
            <Text style={[ss.photoBenefitText, { color: C.primary }]}>
              Adding a photo helps your porter confirm they have the right package, but you can skip this step.
            </Text>
          </View>
        </ScrollView>

        <View style={[ss.footer, { paddingBottom: insets.bottom + TAB_BAR_HEIGHT + 8, backgroundColor: C.background }]}>
          <PrimaryButton
            label={uploadingPhoto ? "Uploading…" : "Continue"}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setStep("delivery-method");
            }}
            disabled={uploadingPhoto}
          />
        </View>
      </View>
    );
  }

  if (step === "delivery-method") {
    if (sendMode === "drop-off" && dropoffBox) {
      const distanceMi = (distanceKm * 0.621371).toFixed(1);
      const dropMapUrl = dropoffBox && dropoffLat
        ? buildStaticMapUrl(dropoffBox.lat, dropoffBox.lng, dropoffLat, dropoffLng, 700, 260, dropoffBoxRoutePolyline)
        : null;

      return (
        <View style={[ss.screen, { backgroundColor: C.background }]}>
          <View style={ss.mapContainer}>
            {dropMapUrl ? (
              <Image source={{ uri: dropMapUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: "#D0D8E0" }]} />
            )}
            <View style={[ss.mapTopRow, { paddingTop: insets.top + 8 }]}>
              <Pressable
                onPress={() => setStep("photo")}
                style={({ pressed }) => [ss.mapBackBtn, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Feather name="arrow-left" size={20} color="#fff" />
              </Pressable>
              <Text style={ss.mapStepLabel}>Step 4 of 4</Text>
            </View>
            <View style={ss.mapBadge}>
              <Feather name="map-pin" size={12} color="#fff" />
              <Text style={ss.mapBadgeText}>{distanceMi} mi</Text>
            </View>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[ss.methodContent, { paddingBottom: insets.bottom + 180 }]}
          >
            <View style={[ss.dropoffDestCard, { backgroundColor: "#F5F0FF", borderColor: "#DDD6FE" }]}>
              <Feather name="inbox" size={18} color="#7C3AED" style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={[ss.sectionLabel, { color: "#7C3AED", marginBottom: 2, marginTop: 0 }]}>Drop off at</Text>
                <Text style={[ss.boxCardName, { color: C.text, fontSize: 15 }]}>{dropoffBox.name}</Text>
                <Text style={[ss.boxCardAddr, { color: C.textSecondary, fontSize: 12 }]} numberOfLines={2}>{dropoffBox.address}</Text>
              </View>
            </View>

            <View style={ss.routeSummary}>
              <View style={ss.routeRow}>
                <View style={[ss.routeDot, { backgroundColor: "#7C3AED" }]} />
                <Text style={[ss.routeAddr, { color: C.text }]} numberOfLines={1}>{dropoffBox.address}</Text>
              </View>
              <View style={[ss.routeLine, { backgroundColor: C.border }]} />
              <View style={ss.routeRow}>
                <View style={[ss.routeDot, { backgroundColor: C.error }]} />
                <Text style={[ss.routeAddr, { color: C.text }]} numberOfLines={1}>{dropoffAddress}</Text>
              </View>
            </View>

            <View style={[ss.dropoffDestCard, { backgroundColor: "#F0FAF6", borderColor: "#A7F3D0", flexDirection: "column", gap: 4 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Feather name="tag" size={15} color="#059669" />
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: C.text }}>
                  ${finalPrice.toFixed(2)}
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary }}> · Drop-off price</Text>
                </Text>
              </View>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#059669" }}>
                15% discount applied — you're saving ${(basePrice - finalPrice).toFixed(2)} vs scheduled pickup
              </Text>
            </View>
          </ScrollView>

          <View style={[ss.paymentFooter, { paddingBottom: insets.bottom + TAB_BAR_HEIGHT + 8, backgroundColor: C.surface, borderTopColor: C.border }]}>
            {stripeError ? (
              <View style={[ss.stripeErrorRow, { backgroundColor: "#FEF2F2" }]}>
                <Feather name="alert-circle" size={14} color="#EF4444" />
                <Text style={ss.stripeErrorText}>{stripeError}</Text>
              </View>
            ) : null}
            {!stripeReady && __DEV__ && Platform.OS !== "web" && (
              <Pressable
                onPress={handleDevBypass}
                disabled={devBypassing}
                style={({ pressed }) => [ss.cardPayBtn, { backgroundColor: "#B45309", opacity: devBypassing || pressed ? 0.7 : 1 }]}
              >
                {devBypassing
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={ss.cardPayBtnText}>Continue (Dev Mode · No Payment)</Text>
                }
              </Pressable>
            )}
            {Platform.OS === "ios" && (
              <Pressable
                onPress={() => { if (!stripeReady) return; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowPayment(true); }}
                disabled={!stripeReady}
                style={({ pressed }) => [ss.applePayBtn, { opacity: stripeReady ? (pressed ? 0.8 : 1) : 0.4 }]}
              >
                <View style={ss.applePayBadge}><Text style={ss.applePayBadgeText}>Pay</Text></View>
                <Text style={ss.applePayBtnText}>Apple Pay</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => { if (!stripeReady) return; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowPayment(true); }}
              disabled={!stripeReady}
              style={({ pressed }) => [ss.cardPayBtn, { backgroundColor: stripeReady ? "#7C3AED" : C.border, opacity: pressed ? 0.85 : 1 }]}
            >
              <Feather name="inbox" size={18} color="#fff" />
              <Text style={ss.cardPayBtnText}>Pay & Get Drop-off Code · ${finalPrice.toFixed(2)}</Text>
            </Pressable>
            <View style={ss.secureRow}>
              <Feather name="lock" size={11} color={C.textTertiary} />
              <Text style={[ss.secureNote, { color: C.textTertiary }]}>Secured by Stripe</Text>
            </View>
          </View>

          {user && (
            <PaymentBottomSheet
              visible={showPayment}
              onClose={() => setShowPayment(false)}
              onCancelled={() => setShowPayment(false)}
              onSuccess={handlePaymentSuccess}
              estimatedPrice={finalPrice}
              distanceKm={distanceKm}
              userId={user.id}
              deliveryData={deliveryData}
              confirmLabel="Continue with Drop-off"
            />
          )}
        </View>
      );
    }

    const priorityPrice = basePrice;
    const savingsPrice = Math.round(basePrice * 0.85 * 100) / 100;
    const distanceMi = (distanceKm * 0.621371).toFixed(1);
    const headerDropoffLat = (serviceLevel === "porter-box" && selectedPorterBox) ? selectedPorterBox.lat : dropoffLat;
    const headerDropoffLng = (serviceLevel === "porter-box" && selectedPorterBox) ? selectedPorterBox.lng : dropoffLng;
    const headerRoutePoly = serviceLevel === "porter-box" ? boxRoutePolyline : deliveryRoutePolyline;
    const mapUrl = buildStaticMapUrl(pickupLat, pickupLng, headerDropoffLat, headerDropoffLng, 700, 260, headerRoutePoly);

    const filterChips: { label: string; icon: FeatherIconName; onPress: () => void }[] = [
      ...(largeCount > 0 ? [{ label: `Large ×${largeCount}`, icon: "archive" as FeatherIconName, onPress: () => setStep("port-details") }] : []),
      ...(standardCount > 0 ? [{ label: `Std ×${standardCount}`, icon: "package" as FeatherIconName, onPress: () => setStep("port-details") }] : []),
      ...(smallCount > 0 ? [{ label: `Small ×${smallCount}`, icon: "box" as FeatherIconName, onPress: () => setStep("port-details") }] : []),
      { label: specialRequests ? "Requests ✓" : "No requests", icon: "edit-2" as FeatherIconName, onPress: () => setStep("port-details") },
    ];

    return (
      <View style={[ss.screen, { backgroundColor: C.background }]}>
        <View style={ss.mapContainer}>
          <Image source={{ uri: mapUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              const ctx = serviceLevel === "porter-box" ? "porter-boxes" : "route";
              setMapModalContext(ctx);
              setMapModalVisible(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
          />
          <View style={[ss.mapTopRow, { paddingTop: insets.top + 8 }]}>
            <Pressable
              onPress={() => setStep("photo")}
              style={({ pressed }) => [ss.mapBackBtn, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Feather name="arrow-left" size={20} color="#fff" />
            </Pressable>
            <Text style={ss.mapStepLabel}>Step 4 of 4</Text>
          </View>
          <View style={ss.mapBadge}>
            <Feather name="map-pin" size={12} color="#fff" />
            <Text style={ss.mapBadgeText}>{distanceMi} mi</Text>
          </View>
          <View style={ss.mapExpandBadgeHero} pointerEvents="none">
            <Feather name="maximize-2" size={11} color="#fff" />
            <Text style={ss.mapExpandText}>Tap to explore</Text>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[ss.methodContent, { paddingBottom: insets.bottom + 180 }]}
        >
          <View style={ss.routeSummary}>
            <View style={ss.routeRow}>
              <View style={[ss.routeDot, { backgroundColor: C.primary }]} />
              <Text style={[ss.routeAddr, { color: C.text }]} numberOfLines={1}>
                {pickupAddress}
              </Text>
            </View>
            <View style={[ss.routeLine, { backgroundColor: C.border }]} />
            <View style={ss.routeRow}>
              <View style={[ss.routeDot, { backgroundColor: C.error }]} />
              <Text style={[ss.routeAddr, { color: C.text }]} numberOfLines={1}>
                {effectiveDropoff.address}
              </Text>
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ss.filterChipsScroll} contentContainerStyle={ss.filterChipsRow}>
            {filterChips.map((chip) => (
              <Pressable
                key={chip.label}
                onPress={() => { chip.onPress(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                style={({ pressed }) => [ss.filterChip, { backgroundColor: C.surface, borderColor: C.border, opacity: pressed ? 0.7 : 1 }]}
              >
                <Feather name={chip.icon} size={12} color={C.primary} />
                <Text style={[ss.filterChipText, { color: C.text }]}>{chip.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={[ss.methodLabel, { color: C.text }]}>Choose your service</Text>

          <Pressable
            onPress={() => { setServiceLevel("priority"); setSelectedPorterBox(null); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            style={[
              ss.serviceOptionCard,
              serviceLevel === "priority"
                ? { backgroundColor: C.primaryLight, borderColor: C.primary, borderWidth: 2 }
                : { backgroundColor: C.surface, borderColor: C.border, borderWidth: 1.5 },
            ]}
          >
            <View style={ss.serviceOptionRow}>
              <View style={[ss.serviceOptionIconWrap, { backgroundColor: serviceLevel === "priority" ? C.primary : C.surfaceSecondary }]}>
                <Feather name="zap" size={18} color={serviceLevel === "priority" ? "#fff" : C.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[ss.serviceOptionTitle, { color: C.text }]}>Priority</Text>
                <Text style={[ss.serviceOptionDesc, { color: C.textSecondary }]}>Porter dispatched immediately · 15–25 min</Text>
              </View>
              <View style={ss.serviceOptionPriceCol}>
                <Text style={[ss.serviceOptionPrice, { color: C.primary }]}>${priorityPrice.toFixed(2)}</Text>
              </View>
              <View style={[ss.serviceOptionRadio, { borderColor: serviceLevel === "priority" ? C.primary : C.border, backgroundColor: serviceLevel === "priority" ? C.primary : "transparent" }]}>
                {serviceLevel === "priority" && <Feather name="check" size={12} color="#fff" />}
              </View>
            </View>
          </Pressable>

          <Pressable
            onPress={() => { setServiceLevel("wait-save"); setSelectedPorterBox(null); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            style={[
              ss.serviceOptionCard,
              serviceLevel === "wait-save"
                ? { backgroundColor: "#F0FAF6", borderColor: C.accent, borderWidth: 2 }
                : { backgroundColor: C.surface, borderColor: C.border, borderWidth: 1.5 },
            ]}
          >
            <View style={ss.serviceOptionRow}>
              <View style={[ss.serviceOptionIconWrap, { backgroundColor: serviceLevel === "wait-save" ? C.accent : C.surfaceSecondary }]}>
                <Feather name="clock" size={18} color={serviceLevel === "wait-save" ? "#fff" : C.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[ss.serviceOptionTitle, { color: C.text }]}>Wait & Save</Text>
                <Text style={[ss.serviceOptionDesc, { color: C.textSecondary }]}>Picks up in ~15 min · 25–40 min delivery</Text>
              </View>
              <View style={ss.serviceOptionPriceCol}>
                <Text style={[ss.serviceOptionPrice, { color: C.accent }]}>${savingsPrice.toFixed(2)}</Text>
                <Text style={[ss.serviceOptionSave, { color: C.accent }]}>Save 15%</Text>
              </View>
              <View style={[ss.serviceOptionRadio, { borderColor: serviceLevel === "wait-save" ? C.accent : C.border, backgroundColor: serviceLevel === "wait-save" ? C.accent : "transparent" }]}>
                {serviceLevel === "wait-save" && <Feather name="check" size={12} color="#fff" />}
              </View>
            </View>
          </Pressable>

          <Pressable
            onPress={() => { setServiceLevel("porter-box"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            style={[
              ss.serviceOptionCard,
              serviceLevel === "porter-box"
                ? { backgroundColor: "#F5F0FF", borderColor: "#7C3AED", borderWidth: 2 }
                : { backgroundColor: C.surface, borderColor: C.border, borderWidth: 1.5 },
            ]}
          >
            <View style={ss.serviceOptionRow}>
              <View style={[ss.serviceOptionIconWrap, { backgroundColor: serviceLevel === "porter-box" ? "#7C3AED" : C.surfaceSecondary }]}>
                <Feather name="inbox" size={18} color={serviceLevel === "porter-box" ? "#fff" : C.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[ss.serviceOptionTitle, { color: C.text }]}>Porter Box</Text>
                <Text style={[ss.serviceOptionDesc, { color: C.textSecondary }]}>Porter drops off at secure locker · You collect anytime</Text>
              </View>
              <View style={ss.serviceOptionPriceCol}>
                <Text style={[ss.serviceOptionPrice, { color: "#7C3AED" }]}>${priorityPrice.toFixed(2)}</Text>
                <Text style={[ss.serviceOptionSave, { color: "#7C3AED" }]}>Flexible</Text>
              </View>
              <View style={[ss.serviceOptionRadio, { borderColor: serviceLevel === "porter-box" ? "#7C3AED" : C.border, backgroundColor: serviceLevel === "porter-box" ? "#7C3AED" : "transparent" }]}>
                {serviceLevel === "porter-box" && <Feather name="check" size={12} color="#fff" />}
              </View>
            </View>
          </Pressable>

          {serviceLevel === "porter-box" && (
            <View style={[ss.boxSelectorWrap, { backgroundColor: C.surface, borderColor: "#7C3AED" }]}>
              <View style={ss.boxSelectorHeader}>
                <Text style={[ss.boxSelectorTitle, { color: C.text }]}>
                  <Feather name="map-pin" size={14} color="#7C3AED" /> Select a Porter Box
                </Text>
                {porterBoxes.length > 0 && (
                  <Pressable
                    onPress={() => {
                      setMapModalContext("porter-boxes");
                      setMapModalVisible(true);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    style={({ pressed }) => [ss.viewOnMapBtn, { opacity: pressed ? 0.75 : 1 }]}
                  >
                    <Feather name="map" size={13} color="#7C3AED" />
                    <Text style={ss.viewOnMapText}>View on map</Text>
                  </Pressable>
                )}
              </View>
              {porterBoxesLoading ? (
                <ActivityIndicator color="#7C3AED" style={{ marginVertical: 12 }} />
              ) : porterBoxes.length === 0 ? (
                <Text style={[ss.boxSelectorEmpty, { color: C.textSecondary }]}>No boxes available nearby</Text>
              ) : (
                <>
                  {(() => {
                    const boxMapUrl = buildPorterBoxMapUrl(
                      porterBoxes,
                      selectedPorterBox?.id ?? null,
                      pickupLat,
                      pickupLng,
                      dropoffLat || null,
                      dropoffLng || null,
                      boxRoutePolyline,
                      800,
                      280
                    );
                    return boxMapUrl ? (
                      <Pressable
                        onPress={() => {
                          setMapModalContext("porter-boxes");
                          setMapModalVisible(true);
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }}
                        style={ss.mapPressable}
                      >
                        <Image source={{ uri: boxMapUrl }} style={ss.porterBoxMap} contentFit="cover" />
                        <View style={ss.mapExpandBadge} pointerEvents="none">
                          <Feather name="maximize-2" size={11} color="#fff" />
                          <Text style={ss.mapExpandText}>Tap to explore</Text>
                        </View>
                      </Pressable>
                    ) : null;
                  })()}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={ss.boxCardScroll}
                    contentContainerStyle={ss.boxCardScrollContent}
                  >
                    {porterBoxes.map((box, idx) => {
                      const isSelected = selectedPorterBox?.id === box.id;
                      return (
                        <Pressable
                          key={box.id}
                          onPress={() => {
                            setSelectedPorterBox(box);
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          }}
                          style={[
                            ss.boxCard,
                            {
                              borderColor: isSelected ? "#7C3AED" : C.border,
                              backgroundColor: isSelected ? "#F5F0FF" : C.background,
                            },
                          ]}
                        >
                          <View style={[ss.boxCardNumBadge, { backgroundColor: isSelected ? "#7C3AED" : C.surfaceSecondary }]}>
                            <Text style={[ss.boxCardNumText, { color: isSelected ? "#fff" : C.textSecondary }]}>{idx + 1}</Text>
                          </View>
                          <Text style={[ss.boxCardName, { color: C.text }]} numberOfLines={1}>{box.name}</Text>
                          <Text style={[ss.boxCardAddr, { color: C.textSecondary }]} numberOfLines={2}>{box.address}</Text>
                          {box.distanceKm != null && (
                            <Text style={[ss.boxCardDist, { color: "#7C3AED" }]}>{(box.distanceKm * 0.621371).toFixed(1)} mi</Text>
                          )}
                          {isSelected && (
                            <View style={ss.boxCardCheckRow}>
                              <Feather name="check-circle" size={14} color="#7C3AED" />
                              <Text style={[ss.boxCardCheckText, { color: "#7C3AED" }]}>Selected</Text>
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </>
              )}
            </View>
          )}
        </ScrollView>

        <View
          style={[
            ss.paymentFooter,
            {
              paddingBottom: insets.bottom + TAB_BAR_HEIGHT + 8,
              backgroundColor: C.surface,
              borderTopColor: C.border,
            },
          ]}
        >
          {stripeError ? (
            <View style={[ss.stripeErrorRow, { backgroundColor: "#FEF2F2" }]}>
              <Feather name="alert-circle" size={14} color="#EF4444" />
              <Text style={ss.stripeErrorText}>{stripeError}</Text>
            </View>
          ) : null}
          {!stripeReady && __DEV__ && Platform.OS !== "web" && (
            <Pressable
              onPress={handleDevBypass}
              disabled={devBypassing || (serviceLevel === "porter-box" && !porterBoxReady)}
              style={({ pressed }) => [ss.cardPayBtn, { backgroundColor: "#B45309", opacity: (devBypassing || pressed) ? 0.7 : 1 }]}
            >
              {devBypassing
                ? <ActivityIndicator color="#fff" />
                : <Text style={ss.cardPayBtnText}>Continue (Dev Mode · No Payment)</Text>
              }
            </Pressable>
          )}
          {Platform.OS === "ios" && (
            <Pressable
              onPress={() => {
                if (!stripeReady) return;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setShowPayment(true);
              }}
              disabled={!stripeReady}
              style={({ pressed }) => [ss.applePayBtn, { opacity: stripeReady ? (pressed ? 0.8 : 1) : 0.4 }]}
            >
              <View style={ss.applePayBadge}>
                <Text style={ss.applePayBadgeText}>Pay</Text>
              </View>
              <Text style={ss.applePayBtnText}>Apple Pay</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => {
              if (!stripeReady || !porterBoxReady) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setShowPayment(true);
            }}
            disabled={!stripeReady || !porterBoxReady}
            style={({ pressed }) => [
              ss.cardPayBtn,
              {
                backgroundColor: (stripeReady && porterBoxReady) ? (serviceLevel === "porter-box" ? "#7C3AED" : C.primary) : C.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Feather name={serviceLevel === "porter-box" ? "inbox" : "credit-card"} size={18} color="#fff" />
            <Text style={ss.cardPayBtnText}>
              {serviceLevel === "priority" && `Continue with Priority · $${finalPrice.toFixed(2)}`}
              {serviceLevel === "wait-save" && `Continue with Wait & Save · $${finalPrice.toFixed(2)}`}
              {serviceLevel === "porter-box" && (selectedPorterBox ? `Drop at ${selectedPorterBox.name} · $${finalPrice.toFixed(2)}` : "Select a Porter Box")}
            </Text>
          </Pressable>
          <View style={ss.secureRow}>
            <Feather name="lock" size={11} color={C.textTertiary} />
            <Text style={[ss.secureNote, { color: C.textTertiary }]}>Secured by Stripe</Text>
          </View>
        </View>

        {user && (
          <PaymentBottomSheet
            visible={showPayment}
            onClose={() => setShowPayment(false)}
            onCancelled={() => setShowPayment(false)}
            onSuccess={handlePaymentSuccess}
            estimatedPrice={finalPrice}
            distanceKm={distanceKm}
            userId={user.id}
            deliveryData={deliveryData}
            confirmLabel={
              serviceLevel === "wait-save"
                ? "Continue with Wait & Save"
                : serviceLevel === "porter-box"
                ? "Continue with Porter Box"
                : "Continue with Priority"
            }
          />
        )}
      {mapModalNode}
      </View>
    );
  }

  if (step === "finding-porter") {
    if (sendMode === "drop-off" && dropoffBox && findingDelivery) {
      const pickupCode = findingDelivery.pickupCode ?? undefined;
      const dropMapUrl = buildStaticMapUrl(dropoffBox.lat, dropoffBox.lng, dropoffLat, dropoffLng, 700, 260, dropoffBoxRoutePolyline);

      return (
        <View style={[ss.screen, { backgroundColor: C.background }]}>
          <View style={[ss.findingMapContainer, { paddingTop: insets.top }]}>
            <Image source={{ uri: dropMapUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
            <View style={ss.findingMapOverlay}>
              <Feather name="inbox" size={15} color="#fff" />
              <Text style={ss.findingMapLabel}>Bring package to {dropoffBox.name}</Text>
            </View>
          </View>

          <View style={[ss.findingSheet, { backgroundColor: C.surface }]}>
            <View style={[ss.findingDragIndicator, { backgroundColor: C.border }]} />
            <Text style={[ss.findingTitle, { color: C.text }]}>Drop off your package</Text>
            <Text style={[ss.findingSubtitle, { color: C.textSecondary }]}>
              Use this code to open the Porter Box. A porter will collect it and deliver to the recipient.
            </Text>

            {/* Drop-off code display */}
            {pickupCode ? (
              <View style={{ alignItems: "center", marginBottom: 20 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <Feather name="lock" size={13} color={C.textSecondary} />
                  <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary }}>Your drop-off code</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {pickupCode.split("").map((char, i) => (
                    <View
                      key={i}
                      style={{
                        width: 46,
                        height: 54,
                        borderRadius: 12,
                        backgroundColor: "#F5F0FF",
                        borderWidth: 2,
                        borderColor: "#7C3AED",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ fontSize: 24, fontFamily: "Inter_700Bold", color: "#7C3AED" }}>{char}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <ActivityIndicator color="#7C3AED" style={{ marginBottom: 20 }} />
            )}

            {/* Box info card */}
            <View style={[ss.dropoffDestCard, { backgroundColor: "#F5F0FF", borderColor: "#DDD6FE", marginBottom: 16 }]}>
              <Feather name="map-pin" size={18} color="#7C3AED" style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={[ss.boxCardName, { color: C.text, fontSize: 15 }]}>{dropoffBox.name}</Text>
                <Text style={[ss.boxCardAddr, { color: C.textSecondary, fontSize: 12 }]} numberOfLines={2}>{dropoffBox.address}</Text>
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [
                ss.primaryBtn,
                { backgroundColor: C.primary, opacity: pressed ? 0.85 : 1, marginBottom: 12 },
              ]}
              onPress={() => {
                if (findingDeliveryId) {
                  router.replace({ pathname: "/tracking/[id]", params: { id: findingDeliveryId } });
                }
              }}
            >
              <Text style={[ss.primaryBtnText, { color: "#fff" }]}>Track delivery</Text>
            </Pressable>

            <View style={[ss.findingFooter, { paddingBottom: insets.bottom + 8 }]}>
              <Feather name="shield" size={13} color={C.textTertiary} />
              <Text style={[ss.findingFooterText, { color: C.textTertiary }]}>
                Secured by Porter · Insured deliveries
              </Text>
            </View>
          </View>
          {mapModalNode}
        </View>
      );
    }

    const routePoly = serviceLevel === "porter-box" ? boxRoutePolyline : deliveryRoutePolyline;
    const mapUrl =
      pickupLat && effectiveDropoff.lat
        ? buildStaticMapUrl(pickupLat, pickupLng, effectiveDropoff.lat, effectiveDropoff.lng, 700, 260, routePoly)
        : null;
    return (
      <>
        <FindingPorterScreen
          insets={insets}
          C={C}
          mapUrl={mapUrl}
          onMapPress={() => {
            setMapModalContext("route");
            setMapModalVisible(true);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
        />
        {mapModalNode}
      </>
    );
  }

  return null;
}

function FindingPorterScreen({
  insets,
  C,
  mapUrl,
  onMapPress,
}: {
  insets: ReturnType<typeof useSafeAreaInsets>;
  C: ReturnType<typeof useColors>;
  mapUrl: string | null;
  onMapPress?: () => void;
}) {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  return (
    <View style={[ss.screen, { backgroundColor: C.background }]}>
      <View style={[ss.findingMapContainer, { paddingTop: insets.top }]}>
        {mapUrl ? (
          <Image source={{ uri: mapUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" }]}>
            <ActivityIndicator size="large" color={C.primary} />
          </View>
        )}
        {mapUrl && onMapPress && (
          <Pressable style={StyleSheet.absoluteFill} onPress={onMapPress} />
        )}
        {mapUrl && (
          <View style={ss.mapExpandBadgeHero} pointerEvents="none">
            <Feather name="maximize-2" size={11} color="#fff" />
            <Text style={ss.mapExpandText}>Tap to explore</Text>
          </View>
        )}
        <View style={ss.findingMapOverlay}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={ss.findingMapLabel}>Finding nearby porters…</Text>
        </View>
      </View>

      <View style={[ss.findingSheet, { backgroundColor: C.surface }]}>
        <View style={[ss.findingDragIndicator, { backgroundColor: C.border }]} />
        <Text style={[ss.findingTitle, { color: C.text }]}>Finding your porter</Text>
        <Text style={[ss.findingSubtitle, { color: C.textSecondary }]}>
          Hang tight — a Porter is on their way to you
        </Text>

        {[0, 1, 2].map((i) => (
          <View key={i} style={[ss.skeletonRow, { borderBottomColor: C.border }]}>
            <Animated.View
              style={[ss.skeletonAvatar, { backgroundColor: C.border, opacity: pulseAnim }]}
            />
            <View style={{ flex: 1, gap: 8 }}>
              <Animated.View
                style={{ width: "60%", height: 14, borderRadius: 7, backgroundColor: C.border, opacity: pulseAnim }}
              />
              <Animated.View
                style={{ width: "40%", height: 10, borderRadius: 5, backgroundColor: C.border, opacity: pulseAnim }}
              />
            </View>
            <Animated.View
              style={{ width: 40, height: 14, borderRadius: 7, backgroundColor: C.border, opacity: pulseAnim }}
            />
          </View>
        ))}

        <View style={[ss.findingFooter, { paddingBottom: insets.bottom + 8 }]}>
          <Feather name="shield" size={13} color={C.textTertiary} />
          <Text style={[ss.findingFooterText, { color: C.textTertiary }]}>
            Secured by Porter · Insured deliveries
          </Text>
        </View>
      </View>
    </View>
  );
}

const ss = StyleSheet.create({
  screen: { flex: 1 },

  header: { paddingHorizontal: 16, paddingBottom: 8 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitles: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", textAlign: "center" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },

  addressCardOuter: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, overflow: "visible" },
  addressCard: { gap: 16, overflow: "visible" },
  favoritesScrollContent: { paddingHorizontal: 16, gap: 16 },
  addressDivider: { height: 1, marginHorizontal: 4 },
  addressMapPreview: {
    width: "100%",
    height: 180,
    borderRadius: 16,
    overflow: "hidden",
  },
  addressMapPlaceholder: {
    width: "100%",
    height: 180,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  addressMapPlaceholderText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  porterBoxMap: {
    width: "100%",
    height: 160,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.6,
    marginBottom: 10,
    textTransform: "uppercase",
  },
  favoritesWrap: { gap: 10 },
  favTile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  favTileIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  favTileLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  favTileSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 1 },

  portTypeContent: { paddingHorizontal: 16, paddingTop: 4, gap: 12 },
  stepHint: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 4 },
  portTypeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1.5,
  },
  portTypeIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  portTypeLabel: { fontSize: 17, fontFamily: "Inter_700Bold" },
  portTypeDesc: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  portTypeRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },

  detailsContent: { paddingHorizontal: 16, paddingTop: 4 },
  countersCard: { borderRadius: 18, borderWidth: 1, overflow: "hidden" },
  counterRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 12,
  },
  counterInfo: { flex: 1 },
  counterLabel: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  counterSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  counterControls: { flexDirection: "row", alignItems: "center", gap: 12 },
  counterBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  counterValue: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center", minWidth: 28 },
  textareaWrap: { borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12 },
  textarea: { fontSize: 14, fontFamily: "Inter_400Regular", minHeight: 88, lineHeight: 20 },

  mapContainer: { height: 230, backgroundColor: "#D0D8E0", overflow: "hidden" },
  mapTopRow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 12,
  },
  mapBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.40)",
    alignItems: "center",
    justifyContent: "center",
  },
  mapStepLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  mapBadge: {
    position: "absolute",
    bottom: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(0,0,0,0.52)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  mapBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  mapPressable: { position: "relative" },
  mapExpandBadge: {
    position: "absolute",
    bottom: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.52)",
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  mapExpandBadgeHero: {
    position: "absolute",
    bottom: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.52)",
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  mapExpandText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  mapExpandHint: {
    position: "absolute",
    bottom: 10,
    right: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  mapExpandHintText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  methodContent: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  routeSummary: { marginBottom: 4 },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 5 },
  routeDot: { width: 10, height: 10, borderRadius: 5 },
  routeLine: { width: 2, height: 10, borderRadius: 1, marginLeft: 4 },
  routeAddr: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  methodLabel: { fontSize: 18, fontFamily: "Inter_700Bold" },

  filterChipsScroll: { marginBottom: 4 },
  filterChipsRow: { flexDirection: "row", gap: 8, paddingRight: 16 },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  filterChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },

  serviceOptionCard: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  serviceOptionRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  serviceOptionIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  serviceOptionTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  serviceOptionDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 17 },
  serviceOptionPriceCol: { alignItems: "flex-end" },
  serviceOptionPrice: { fontSize: 20, fontFamily: "Inter_700Bold" },
  serviceOptionSave: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  serviceOptionRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },

  photoPreview: {
    width: "100%",
    height: 240,
    borderRadius: 20,
    borderWidth: 1.5,
    overflow: "hidden",
  },
  photoRetakeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingVertical: 12,
  },
  photoRetakeTxt: { fontSize: 14, fontFamily: "Inter_500Medium" },
  photoPickerRow: {
    flexDirection: "row",
    gap: 14,
  },
  photoPickerBtn: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 20,
    alignItems: "center",
    gap: 10,
  },
  photoPickerIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  photoPickerLabel: { fontSize: 15, fontFamily: "Inter_700Bold" },
  photoPickerSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  photoBenefitCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  photoBenefitText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },

  boxSelectorWrap: {
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 16,
    gap: 10,
  },
  boxSelectorHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  boxSelectorTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  viewOnMapBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: "#F5F0FF",
  },
  viewOnMapText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#7C3AED",
  },
  boxSelectorEmpty: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingVertical: 8,
  },
  boxCardScroll: { marginHorizontal: -4 },
  boxCardScrollContent: { paddingHorizontal: 4, gap: 10 },
  boxCard: {
    width: 160,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 4,
  },
  boxCardNumBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  boxCardNumText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  boxCardName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  boxCardAddr: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 15 },
  boxCardDist: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  boxCardCheckRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  boxCardCheckText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  paymentFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 10,
  },
  applePayBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#000",
    borderRadius: 14,
    height: 52,
  },
  applePayBadge: {
    backgroundColor: "#fff",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  applePayBadgeText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#000" },
  applePayBtnText: { fontSize: 16, fontFamily: "Inter_500Medium", color: "#fff" },
  cardPayBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 14,
    height: 52,
  },
  cardPayBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  secureRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingBottom: 4,
  },
  secureNote: { fontSize: 12, fontFamily: "Inter_400Regular" },
  stripeErrorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  stripeErrorText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#EF4444", flex: 1 },

  primaryBtn: {
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#123E6B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  primaryBtnText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  footer: { paddingHorizontal: 16, paddingTop: 12 },

  findingMapContainer: { height: 250, backgroundColor: "#D0D8E0", overflow: "hidden" },
  findingMapOverlay: {
    position: "absolute",
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(0,0,0,0.38)",
    paddingVertical: 8,
  },
  findingMapLabel: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: "#fff",
  },
  findingSheet: {
    flex: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -24,
    paddingHorizontal: 24,
    paddingTop: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 16,
  },
  findingDragIndicator: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  findingTitle: { fontSize: 22, fontFamily: "Inter_700Bold", textAlign: "center" },
  findingSubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 24,
    lineHeight: 20,
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  skeletonAvatar: { width: 44, height: 44, borderRadius: 22 },
  findingFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 24,
  },
  findingFooterText: { fontSize: 12, fontFamily: "Inter_400Regular" },

  modeSelectorRow: {
    flexDirection: "row",
    gap: 10,
  },
  modeSelectorBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  modeSelectorText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  dropoffModeHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 2,
  },
  dropoffModeHintText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  dropoffDestCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
  },
  dropoffBoxListCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
  },
});
