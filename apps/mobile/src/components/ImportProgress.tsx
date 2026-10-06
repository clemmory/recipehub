import { useEffect, useRef } from 'react';
import { View, Text, Pressable, Image, StyleSheet, Animated, Easing, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, radii, labelText } from '../lib/theme';
import { useElapsed, type ProgressStep } from '../lib/progress';
import { SIDE } from './ui';

// Import waiting screen (2026-10-01, replaced the spinner in the button +
// one changing message): progress bar, a preview and a checklist. Still
// driven by time, not by the server — one call can't report its phase —
// so the last step only gets checked by the real answer (the screen is
// then left for the review).
export default function ImportProgress({
  steps,
  expectedMs,
  previewUri,
  previewBadge,
  onCancel,
}: {
  steps: ProgressStep[];
  // Typical total duration: the bar slows down past it rather than filling up.
  expectedMs: number;
  // Shown as soon as known (photo import: the first page). Null = a plain
  // surface block — an Instagram post's cover only arrives with the draft.
  previewUri?: string | null;
  previewBadge?: { icon: keyof typeof Feather.glyphMap; text: string };
  onCancel: () => void;
}) {
  const elapsed = useElapsed(true);
  // Asymptotic: ~80% at the expected duration, never quite full.
  const fraction = 0.95 * (1 - Math.exp((-1.75 * elapsed) / expectedMs));
  const slow = elapsed > expectedMs * 1.6;
  let current = 0;
  steps.forEach((step, i) => {
    if (elapsed >= step.at) current = i;
  });

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <Text style={labelText}>Import en cours</Text>
          <Pressable onPress={onCancel} hitSlop={10} accessibilityLabel="Annuler l'import">
            <Text style={styles.cancel}>Annuler</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>On prépare ta recette…</Text>

        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }]} />
        </View>

        <View style={styles.preview}>
          {previewUri ? <Image source={{ uri: previewUri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          {previewUri && previewBadge ? (
            <View style={styles.badge}>
              <Feather name={previewBadge.icon} size={15} color={colors.ink} />
              <Text style={styles.badgeText}>{previewBadge.text}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.list}>
          {steps.map((step, i) => {
            const state = i < current ? 'done' : i === current ? 'current' : 'todo';
            return (
              <View key={step.text} style={styles.row}>
                {state === 'done' ? (
                  <View style={styles.doneDot}>
                    <Feather name="check" size={15} color={colors.white} />
                  </View>
                ) : state === 'current' ? (
                  <Spinner />
                ) : (
                  <View style={styles.todoDot} />
                )}
                <Text
                  style={[styles.rowText, state === 'current' && styles.rowTextCurrent, state === 'todo' && styles.rowTextTodo]}
                >
                  {step.text}
                </Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.footer}>
          {slow
            ? "C'est plus long que d'habitude, encore un instant…"
            : `Environ ${Math.round(expectedMs / 1000)} secondes. Tu pourras tout relire avant d'enregistrer.`}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// Terracotta ring turning on a light track: the step in progress.
function Spinner() {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return <Animated.View style={[styles.spinner, { transform: [{ rotate }] }]} />;
}

const DOT = 26;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  content: { paddingHorizontal: SIDE, paddingTop: 16, paddingBottom: 32 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cancel: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.text2 },
  title: {
    fontFamily: fonts.serifSemiBold,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -1,
    color: colors.ink,
    marginTop: 18,
  },
  track: { height: 3, backgroundColor: colors.hairline, marginTop: 18, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 3, backgroundColor: colors.terracotta },
  preview: {
    height: 250,
    borderRadius: radii.photo,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    marginTop: 24,
  },
  badge: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.white,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  badgeText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.ink },
  list: { marginTop: 24, borderTopWidth: 1, borderTopColor: colors.hairline },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 46,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  doneDot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todoDot: { width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 1.5, borderColor: colors.hairline },
  spinner: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2.5,
    borderColor: '#F3DDD3',
    borderTopColor: colors.terracotta,
  },
  rowText: { flex: 1, fontFamily: fonts.sans, fontSize: 15, color: colors.ink },
  rowTextCurrent: { fontFamily: fonts.sansSemiBold },
  rowTextTodo: { color: colors.navInactive },
  footer: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, color: colors.text2, marginTop: 18 },
});
