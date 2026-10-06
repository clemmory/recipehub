// "Blanc éditorial" direction (2026-09-30, replaces the cream one): white
// background, near-black ink, structure from hairlines and white space rather
// than boxes, terracotta as an accent only (labels, step numbers, active tab,
// + button) — see NOTES.md for the full design reference.
export const colors = {
  ink: '#141211',
  white: '#FFFFFF',
  surface: '#F3F2F0',
  hairline: '#E7E5E2',
  // Secondary text — ≥ 4.5:1 on white.
  text2: '#6B6763',
  navInactive: '#8C8883',
  checked: '#9A9690',
  // Dashed border of the « add » tiles (next page, new collection, photo).
  dashed: '#C9C5C0',
  // Dimmed backdrop behind a bottom sheet.
  scrim: 'rgba(20, 18, 17, 0.42)',
  terracotta: '#C4552F',
  // Small uppercase labels on white: #C4552F is too low-contrast at that size.
  terracottaText: '#B0441F',
  green: '#3D4E38',
  danger: '#C0392B',
  dangerBg: '#FBEAEA',
};

export const radii = {
  sm: 8,
  photo: 10,
  md: 12,
  lg: 14,
  xl: 24,
  pill: 999,
};

// Fraunces (serif, titles) + Inter (sans, interface) — loaded in App.tsx via
// @expo-google-fonts.
export const fonts = {
  serifMedium: 'Fraunces_500Medium',
  serifMediumItalic: 'Fraunces_500Medium_Italic',
  serifSemiBold: 'Fraunces_600SemiBold',
  serifBold: 'Fraunces_700Bold',
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemiBold: 'Inter_600SemiBold',
  sansBold: 'Inter_700Bold',
};

// Small uppercase "rubrique" label (tags · duration, section kickers).
export const labelText = {
  fontFamily: fonts.sansBold,
  fontSize: 11,
  letterSpacing: 1.1,
  textTransform: 'uppercase' as const,
  color: colors.terracottaText,
};
