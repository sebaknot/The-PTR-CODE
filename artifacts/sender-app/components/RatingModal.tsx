import React, { useState } from "react";
import { View, Text, Pressable, Modal, StyleSheet, ActivityIndicator, TextInput } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/context/ThemeContext";
import { useUser } from "@/context/UserContext";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? "";

export function RatingModal({
  visible,
  courierName,
  deliveryId,
  onClose,
}: {
  visible: boolean;
  courierName: string;
  deliveryId: string;
  onClose: () => void;
}): React.JSX.Element {
  const C = useColors();
  const { token } = useUser();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (): Promise<void> => {
    if (rating < 1 || submitting) return;
    setSubmitting(true);
    try {
      await fetch(`https://${DOMAIN}/api/deliveries/${deliveryId}/rate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ rating, comment: comment || undefined }),
      });
      setDone(true);
      setTimeout(onClose, 1100);
    } catch {
      // Non-fatal — allow the user to dismiss.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: C.surface }]}>
          {done ? (
            <View style={styles.doneWrap}>
              <View style={[styles.doneBadge, { backgroundColor: C.success + "1A" }]}>
                <Feather name="check" size={30} color={C.success} />
              </View>
              <Text style={[styles.title, { color: C.text }]}>Thank you!</Text>
            </View>
          ) : (
            <>
              <Text style={[styles.title, { color: C.text }]}>Rate your delivery</Text>
              <Text style={[styles.sub, { color: C.textSecondary }]}>
                How was {courierName || "your porter"}?
              </Text>

              <View style={styles.stars}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} onPress={() => setRating(n)} hitSlop={6}>
                    <Feather
                      name="star"
                      size={38}
                      color={n <= rating ? C.accent : C.border}
                      style={{ opacity: n <= rating ? 1 : 0.9 }}
                    />
                  </Pressable>
                ))}
              </View>

              <TextInput
                placeholder="Add a comment (optional)"
                placeholderTextColor={C.textTertiary}
                value={comment}
                onChangeText={setComment}
                style={[styles.input, { color: C.text, borderColor: C.border, backgroundColor: C.surfaceSecondary }]}
                multiline
              />

              <Pressable
                onPress={submit}
                disabled={rating < 1 || submitting}
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: C.primary, opacity: rating < 1 ? 0.4 : pressed ? 0.85 : 1 },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Submit rating</Text>
                )}
              </Pressable>

              <Pressable onPress={onClose} style={styles.skip}>
                <Text style={[styles.skipText, { color: C.textTertiary }]}>Not now</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 36, gap: 14 },
  title: { fontSize: 20, fontWeight: "700", textAlign: "center" },
  sub: { fontSize: 14, textAlign: "center" },
  stars: { flexDirection: "row", justifyContent: "center", gap: 10, marginVertical: 8 },
  input: { minHeight: 56, borderRadius: 14, borderWidth: 1, padding: 12, fontSize: 15, textAlignVertical: "top" },
  button: { borderRadius: 16, paddingVertical: 16, alignItems: "center", marginTop: 4 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  skip: { alignItems: "center", paddingVertical: 6 },
  skipText: { fontSize: 14, fontWeight: "500" },
  doneWrap: { alignItems: "center", gap: 14, paddingVertical: 20 },
  doneBadge: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
});

export default RatingModal;
