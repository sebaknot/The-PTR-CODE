import React, { Component, type ReactNode } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Palettes } from "@/context/ThemeContext";

type Props = { children: ReactNode };
type State = { hasError: boolean; message?: string };

/**
 * Catches render-time crashes anywhere in the tree and shows a recoverable
 * fallback instead of a white screen. Uses the static light palette because a
 * failure may have originated inside the ThemeProvider itself.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "Something went wrong",
    };
  }

  componentDidCatch(error: unknown): void {
    // Wire a real crash reporter (Sentry/Bugsnag) here before launch.
    console.error("Unhandled UI error:", error);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, message: undefined });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    const C = Palettes.light;
    return (
      <View style={[styles.container, { backgroundColor: C.background }]}>
        <Text style={[styles.title, { color: C.text }]}>Something went wrong</Text>
        <Text style={[styles.body, { color: C.textSecondary }]}>
          The app hit an unexpected error. You can try again.
        </Text>
        <Pressable
          onPress={this.handleReset}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: C.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  title: { fontSize: 20, fontWeight: "700" },
  body: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  button: { marginTop: 12, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14 },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});

export default ErrorBoundary;
