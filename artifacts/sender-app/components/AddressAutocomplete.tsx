import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/context/ThemeContext";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "";

type Suggestion = { placeName: string; lat: number; lng: number };

export function AddressAutocomplete({
  label,
  placeholder,
  value,
  dotColor,
  autoFocus,
  onSelect,
}: {
  label: string;
  placeholder?: string;
  value: string;
  dotColor?: string;
  autoFocus?: boolean;
  onSelect: (address: string, lat: number, lng: number) => void;
}): React.JSX.Element {
  const C = useColors();
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppress = useRef(false);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (suppress.current) {
      suppress.current = false;
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    if (!query.trim() || query.trim().length < 3 || !MAPBOX_TOKEN) {
      setSuggestions([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const url =
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
          `?access_token=${MAPBOX_TOKEN}&autocomplete=true&limit=5&types=address,poi,place`;
        const res = await fetch(url);
        const data = (await res.json()) as {
          features?: { place_name: string; center: [number, number] }[];
        };
        setSuggestions(
          (data.features ?? []).map((f) => ({
            placeName: f.place_name,
            lng: f.center[0],
            lat: f.center[1],
          })),
        );
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 320);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  const choose = (s: Suggestion): void => {
    suppress.current = true;
    setQuery(s.placeName);
    setSuggestions([]);
    setFocused(false);
    onSelect(s.placeName, s.lat, s.lng);
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: C.textSecondary }]}>{label}</Text>
      <View
        style={[
          styles.inputRow,
          { backgroundColor: C.surfaceSecondary, borderColor: focused ? C.primary : C.border },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: dotColor ?? C.primary }]} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor={C.textTertiary}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          style={[styles.input, { color: C.text }]}
        />
        {loading ? <ActivityIndicator size="small" color={C.textTertiary} /> : null}
      </View>

      {focused && suggestions.length > 0 ? (
        <View style={[styles.dropdown, { backgroundColor: C.surface, borderColor: C.border }]}>
          {suggestions.map((s, i) => (
            <Pressable
              key={`${s.placeName}-${i}`}
              onPress={() => choose(s)}
              style={({ pressed }) => [
                styles.suggestion,
                { borderBottomColor: C.border, opacity: pressed ? 0.7 : 1 },
                i === suggestions.length - 1 && { borderBottomWidth: 0 },
              ]}
            >
              <Feather name="map-pin" size={14} color={C.textTertiary} />
              <Text numberOfLines={1} style={[styles.suggestionText, { color: C.text }]}>
                {s.placeName}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, height: 52 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  input: { flex: 1, fontSize: 15 },
  dropdown: { borderWidth: 1, borderRadius: 14, marginTop: 4, overflow: "hidden" },
  suggestion: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: 1 },
  suggestionText: { flex: 1, fontSize: 14 },
});

export default AddressAutocomplete;
