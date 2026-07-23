import React from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  Platform,
  ScrollView,
  Image,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from "react-native-maps";
import { useColors } from "@/context/ThemeContext";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "";

export type PorterBox = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  distanceKm?: number | null;
};

type LatLng = { latitude: number; longitude: number };

/** Decode an encoded polyline string into coordinates (Google/Mapbox algorithm). */
function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

export function InteractiveMapModal({
  visible,
  onClose,
  title,
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
  routePolyline,
  routeColor = "#123E6B",
  porterBoxes,
  selectedPorterBoxId,
  onSelectPorterBox,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  routePolyline?: string | null;
  routeColor?: string;
  porterBoxes?: PorterBox[];
  selectedPorterBoxId?: string;
  onSelectPorterBox?: (box: PorterBox) => void;
}): React.JSX.Element {
  const C = useColors();

  const focusLat = pickupLat ?? dropoffLat ?? porterBoxes?.[0]?.lat ?? 40.7549;
  const focusLng = pickupLng ?? dropoffLng ?? porterBoxes?.[0]?.lng ?? -73.984;
  const routeCoords = routePolyline ? decodePolyline(routePolyline) : [];

  const renderMap = (): React.JSX.Element => {
    if (Platform.OS === "web") {
      // react-native-maps has no reliable web renderer; use a Mapbox static image.
      const parts: string[] = [];
      if (pickupLat != null && pickupLng != null)
        parts.push(`pin-s-a+123E6B(${pickupLng},${pickupLat})`);
      if (dropoffLat != null && dropoffLng != null)
        parts.push(`pin-s-b+C8A452(${dropoffLng},${dropoffLat})`);
      (porterBoxes ?? []).forEach((b) => parts.push(`pin-s+7C3AED(${b.lng},${b.lat})`));
      const overlay = parts.length ? parts.join(",") + "/" : "";
      const url = MAPBOX_TOKEN
        ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlay}${focusLng},${focusLat},12,0/700x900@2x?access_token=${MAPBOX_TOKEN}`
        : "";
      return url ? (
        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: C.surfaceSecondary }]} />
      );
    }

    return (
      <MapView
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: focusLat,
          longitude: focusLng,
          latitudeDelta: 0.06,
          longitudeDelta: 0.06,
        }}
      >
        {pickupLat != null && pickupLng != null ? (
          <Marker coordinate={{ latitude: pickupLat, longitude: pickupLng }} title="Pickup" pinColor={routeColor} />
        ) : null}
        {dropoffLat != null && dropoffLng != null ? (
          <Marker coordinate={{ latitude: dropoffLat, longitude: dropoffLng }} title="Dropoff" pinColor="#C8A452" />
        ) : null}
        {(porterBoxes ?? []).map((b) => (
          <Marker
            key={b.id}
            coordinate={{ latitude: b.lat, longitude: b.lng }}
            title={b.name}
            description={b.address}
            pinColor={b.id === selectedPorterBoxId ? "#7C3AED" : "#9AA6B3"}
            onPress={() => onSelectPorterBox?.(b)}
          />
        ))}
        {routeCoords.length > 1 ? (
          <Polyline coordinates={routeCoords} strokeColor={routeColor} strokeWidth={4} />
        ) : null}
      </MapView>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: C.background }]}>
        <View style={styles.mapArea}>
          {renderMap()}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeBtn,
              { backgroundColor: C.surface, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Feather name="x" size={20} color={C.text} />
          </Pressable>
          <View style={[styles.titlePill, { backgroundColor: C.surface }]}>
            <Text style={[styles.titleText, { color: C.text }]}>{title}</Text>
          </View>
        </View>

        {porterBoxes && porterBoxes.length > 0 ? (
          <ScrollView style={[styles.list, { backgroundColor: C.surface }]} contentContainerStyle={styles.listContent}>
            <Text style={[styles.listHeader, { color: C.textSecondary }]}>Select a Porter Box</Text>
            {porterBoxes.map((b) => {
              const selected = b.id === selectedPorterBoxId;
              return (
                <Pressable
                  key={b.id}
                  onPress={() => onSelectPorterBox?.(b)}
                  style={({ pressed }) => [
                    styles.boxRow,
                    {
                      borderColor: selected ? "#7C3AED" : C.border,
                      backgroundColor: selected ? "#7C3AED14" : C.surface,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Feather name="box" size={18} color={selected ? "#7C3AED" : C.textTertiary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.boxName, { color: C.text }]}>{b.name}</Text>
                    {b.address ? (
                      <Text numberOfLines={1} style={[styles.boxAddr, { color: C.textTertiary }]}>
                        {b.address}
                      </Text>
                    ) : null}
                  </View>
                  {selected ? <Feather name="check-circle" size={18} color="#7C3AED" /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  mapArea: { flex: 1 },
  closeBtn: {
    position: "absolute",
    top: 52,
    left: 16,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  titlePill: {
    position: "absolute",
    top: 58,
    alignSelf: "center",
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  titleText: { fontSize: 15, fontWeight: "700" },
  list: { maxHeight: 260, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  listContent: { padding: 18, gap: 10 },
  listHeader: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  boxRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, padding: 14 },
  boxName: { fontSize: 15, fontWeight: "600" },
  boxAddr: { fontSize: 13, marginTop: 2 },
});

export default InteractiveMapModal;
