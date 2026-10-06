import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Animated, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, radii } from '../lib/theme';
import { RoundButton, SIDE } from './ui';

export type AddChoice = 'instagram' | 'photos' | 'manual' | 'existing';

type Row = { choice: AddChoice; icon: keyof typeof Feather.glyphMap; title: string; subtitle: string; tint: string; iconColor: string };

const ROWS: Row[] = [
  {
    choice: 'instagram',
    icon: 'instagram',
    title: 'Depuis Instagram',
    subtitle: "Colle le lien d'un post ou d'un Reel",
    tint: colors.terracotta,
    iconColor: colors.white,
  },
  {
    choice: 'photos',
    icon: 'camera',
    title: 'Depuis des photos',
    subtitle: "Une page de livre, une fiche manuscrite… jusqu'à 5 pages",
    tint: colors.green,
    iconColor: colors.white,
  },
  {
    choice: 'manual',
    icon: 'edit-2',
    title: 'Écrire moi-même',
    subtitle: "Partir d'une fiche vide",
    tint: colors.surface,
    iconColor: colors.ink,
  },
];

// Only inside an open collection (2026-10-01): the recipe picker that used
// to be the first option of that collection's Alert menu.
const EXISTING_ROW: Row = {
  choice: 'existing',
  icon: 'list',
  title: 'Recettes existantes',
  subtitle: 'Ajouter des recettes déjà enregistrées',
  tint: colors.surface,
  iconColor: colors.ink,
};

// The bottom nav's "+" (2026-10-01, replaced an Alert.alert): a bottom sheet
// with the ways to add a recipe. The parent acts on the choice once the
// sheet has finished closing.
export default function AddRecipeSheet({
  visible,
  onClose,
  onChoose,
  includeExisting = false,
}: {
  visible: boolean;
  onClose: () => void;
  onChoose: (choice: AddChoice) => void;
  includeExisting?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  // Stays mounted while the closing animation runs.
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [visible, progress]);

  function close(then?: () => void) {
    Animated.timing(progress, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setMounted(false);
      onClose();
      then?.();
    });
  }

  if (!mounted) return null;

  const rows = includeExisting ? [EXISTING_ROW, ...ROWS] : ROWS;
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [500, 0] });

  return (
    <Modal transparent visible animationType="none" onRequestClose={() => close()} statusBarTranslucent>
      <Animated.View style={[styles.scrim, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} accessibilityLabel="Fermer" />
      </Animated.View>
      <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + 16, transform: [{ translateY }] }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>Ajouter une recette</Text>
          <RoundButton icon="x" label="Fermer" onPress={() => close()} />
        </View>
        {rows.map((row) => (
          <Pressable
            key={row.choice}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => {
              console.log(`[add-sheet] chose ${row.choice}`);
              close(() => onChoose(row.choice));
            }}
          >
            <View style={[styles.badge, { backgroundColor: row.tint }]}>
              <Feather name={row.icon} size={24} color={row.iconColor} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{row.title}</Text>
              <Text style={styles.rowSubtitle}>{row.subtitle}</Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.text2} />
          </Pressable>
        ))}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: SIDE,
    paddingTop: 10,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.hairline },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  title: { fontFamily: fonts.serifSemiBold, fontSize: 28, letterSpacing: -0.8, color: colors.ink },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  rowPressed: { opacity: 0.6 },
  badge: { width: 52, height: 52, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowTitle: { fontFamily: fonts.serifSemiBold, fontSize: 19, letterSpacing: -0.3, color: colors.ink },
  rowSubtitle: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 19, color: colors.text2, marginTop: 2 },
});
