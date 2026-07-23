import React from "react";
import { View, Text, Pressable, Modal, StyleSheet, ScrollView, Image } from "react-native";
import { Feather } from "@expo/vector-icons";
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

/**
 * Web build of the map modal. react-native-maps is native-only, so on web we
 * render a Mapbox static image with pins. Metro resolves this over
 * InteractiveMapModal.tsx on web.
 */
export function InteractiveMapModal({
  visible,
  onClose,
  title,
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
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

  const parts: string[] = [];
  if (pickupLat != null && pickupLng != null) parts.push(`pin-s-a+123E6B(${pickupLng},${pickupLat})`);
  if (dropoffLat != null && dropoffLng != null) parts.push(`pin-s-b+C8A452(${dropoffLng},${dropoffLat})`);
  (porterBoxes ?? []).forEach((b) => parts.push(`pin-s+7C3AED(${b.lng},${b.lat})`));
  const overlay = parts.length ? parts.join(",") + "/" : "";
  const mapUrl = MAPBOX_TOKEN
    ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlay}${focusLng},${focusLat},12,0/700x900@2x?access_token=${MAPBOX_TOKEN}`
    : "";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: C.background }]}>
        <View style={styles.mapArea}>
          {mapUrl ? (
            <Image source={{ uri: mapUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: C.surfaceSecondary }]} />
          )}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.closeBtn, { backgroundColor: C.surface, opacity: pressed ? 0.8 : 1 }]}
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
  closeBtn: { position: "absolute", top: 52, left: 16, width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  titlePill: { position: "absolute", top: 58, alignSelf: "center", paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999 },
  titleText: { fontSize: 15, fontWeight: "700" },
  list: { maxHeight: 260, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  listContent: { padding: 18, gap: 10 },
  listHeader: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  boxRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, padding: 14 },
  boxName: { fontSize: 15, fontWeight: "600" },
  boxAddr: { fontSize: 13, marginTop: 2 },
});

export default InteractiveMapModal;
