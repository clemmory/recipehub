import type { ReactNode } from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../lib/theme';
import { foldText } from '../lib/text';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export type CoverFamily = { color: string; icon: IconName };

// Stems matched against accent- and case-insensitive tags — the first family
// found wins, otherwise the default. Deliberately 3 families only, so the grid
// keeps a readable rhythm (design reference, 2026-09-30).
const SWEET = ['dessert', 'gateau', 'gouter', 'patisser', 'biscuit', 'cookie', 'brioche', 'crepe', 'sucre', 'chocolat'];
const VEGGIE = ['vege', 'vegetarien', 'vegan', 'legume', 'salade', 'veggie'];

const SWEET_COVER: CoverFamily = { color: colors.terracotta, icon: 'cake-variant-outline' };
const VEGGIE_COVER: CoverFamily = { color: colors.green, icon: 'leaf' };
const DEFAULT_COVER: CoverFamily = { color: colors.ink, icon: 'silverware-fork-knife' };

export function coverFor(tags: string[]): CoverFamily {
  for (const tag of tags.map(foldText)) {
    if (SWEET.some((stem) => tag.includes(stem))) return SWEET_COVER;
    if (VEGGIE.some((stem) => tag.includes(stem))) return VEGGIE_COVER;
  }
  return DEFAULT_COVER;
}

// Shown instead of a photo when a recipe has none (typically imported from a
// photo of a cookbook page — that capture is never used as the thumbnail): a
// flat color with a thin white icon in the bottom-left corner.
export default function RecipeCover({
  tags,
  iconSize = 48,
  style,
  children,
}: {
  tags: string[];
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
  // Overlaid content (label, title) — rendered below the icon.
  children?: ReactNode;
}) {
  const { color, icon } = coverFor(tags);
  return (
    <View style={[styles.cover, { backgroundColor: color }, style]}>
      <MaterialCommunityIcons name={icon} size={iconSize} color={colors.white} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { justifyContent: 'flex-end', padding: 14, overflow: 'hidden' },
});
