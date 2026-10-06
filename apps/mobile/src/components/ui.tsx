import type { ReactNode } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, radii, labelText } from '../lib/theme';

// Shared building blocks of the "blanc éditorial" forms (import flow and
// recipe edit, 2026-10-01) — see the "Composants" table of the design
// reference in NOTES.md.

type FeatherName = keyof typeof Feather.glyphMap;

// 44px round button: back, close, search… Surface fill on white, white
// fill over a photo or a colored cover.
export function RoundButton({
  icon,
  onPress,
  label,
  onImage = false,
  style,
}: {
  icon: FeatherName;
  onPress: () => void;
  label: string;
  onImage?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      style={[styles.roundButton, onImage && styles.roundButtonOnImage, style]}
      onPress={onPress}
      hitSlop={4}
      accessibilityLabel={label}
    >
      <Feather name={icon} size={20} color={colors.ink} />
    </Pressable>
  );
}

// Terracotta kicker (« NOUVELLE RECETTE »), big Fraunces title, gray intro.
export function ScreenHeading({
  kicker,
  kickerIcon,
  title,
  intro,
}: {
  kicker: string;
  kickerIcon?: FeatherName;
  title: string;
  intro?: string;
}) {
  return (
    <View style={styles.heading}>
      <View style={styles.kickerRow}>
        {kickerIcon && <Feather name={kickerIcon} size={15} color={colors.terracottaText} />}
        <Text style={labelText}>{kicker}</Text>
      </View>
      <Text style={styles.headingTitle}>{title}</Text>
      {intro ? <Text style={styles.headingIntro}>{intro}</Text> : null}
    </View>
  );
}

// Gray uppercase field label, with an optional element on the right
// (« Coller », « 2 / 5 », « Au moins une »).
export function FieldLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.fieldLabelRow}>
      <Text style={styles.fieldLabel}>{children}</Text>
      {right}
    </View>
  );
}

// Fixed bottom bar holding the screen's main action (black pill).
export function BottomActionBar({
  label,
  onPress,
  disabled = false,
  loading = false,
  arrow = true,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  arrow?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
      <Pressable
        style={[styles.primaryButton, (disabled || loading) && styles.primaryButtonDisabled]}
        onPress={onPress}
        disabled={disabled || loading}
      >
        {loading ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <>
            <Text style={styles.primaryButtonText}>{label}</Text>
            {arrow && <Feather name="arrow-right" size={19} color={colors.white} />}
          </>
        )}
      </Pressable>
    </View>
  );
}

// White pill with a hairline border and an icon on the left.
export function SecondaryButton({
  icon,
  label,
  onPress,
  disabled = false,
  style,
}: {
  icon: FeatherName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable style={[styles.secondaryButton, disabled && styles.disabled, style]} onPress={onPress} disabled={disabled}>
      <Feather name={icon} size={17} color={colors.ink} />
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

// Small surface pill (« Coller »).
export function SmallPillButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.smallPill} onPress={onPress} hitSlop={6}>
      <Text style={styles.smallPillText}>{label}</Text>
    </Pressable>
  );
}

// Surface box with a terracotta icon on the left.
export function InfoNote({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.infoNote}>
      <View style={styles.infoNoteIcon}>{icon}</View>
      <Text style={styles.infoNoteText}>{children}</Text>
    </View>
  );
}

// Dashed « add » tile (next page, new collection, dish photo).
export function DashedTile({
  icon,
  label,
  onPress,
  disabled = false,
  style,
  vertical = false,
}: {
  icon: FeatherName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  vertical?: boolean;
}) {
  return (
    <Pressable
      style={[styles.dashedTile, vertical ? styles.dashedTileVertical : styles.dashedTileRow, disabled && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled}
    >
      <Feather name={icon} size={vertical ? 26 : 20} color={colors.ink} />
      <Text style={[styles.dashedTileText, vertical && styles.dashedTileTextVertical]}>{label}</Text>
    </Pressable>
  );
}

export const SIDE = 20;

const styles = StyleSheet.create({
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundButtonOnImage: { backgroundColor: colors.white },
  heading: { marginTop: 20 },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headingTitle: {
    fontFamily: fonts.serifSemiBold,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -1,
    color: colors.ink,
    marginTop: 8,
  },
  headingIntro: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 23, color: colors.text2, marginTop: 10 },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 20 },
  fieldLabel: { ...labelText, color: colors.text2 },
  bottomBar: {
    paddingTop: 12,
    paddingHorizontal: SIDE,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  primaryButton: {
    height: 54,
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  primaryButtonDisabled: { opacity: 0.35 },
  primaryButtonText: { fontFamily: fonts.sansSemiBold, fontSize: 16, color: colors.white },
  secondaryButton: {
    height: 46,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  secondaryButtonText: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.ink },
  disabled: { opacity: 0.4 },
  smallPill: {
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  smallPillText: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.ink },
  infoNote: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: 15,
  },
  infoNoteIcon: { paddingTop: 1 },
  infoNoteText: { flex: 1, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20, color: colors.ink },
  dashedTile: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.dashed,
    borderRadius: radii.photo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dashedTileRow: { flexDirection: 'row', gap: 10, height: 96 },
  dashedTileVertical: { gap: 8, padding: 8 },
  dashedTileText: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.ink },
  dashedTileTextVertical: { fontSize: 14, textAlign: 'center' },
});

// Inline name editor (new collection, rename a collection — 2026-10-01,
// replaced a boxed field + round check/cross icons): label, underlined
// field, then « Annuler » as text and the confirm action as an ink pill.
export function InlineNameField({
  label,
  value,
  onChangeText,
  placeholder,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
  error,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  // Shown under the field (e.g. a name already taken).
  error?: string | null;
}) {
  const canConfirm = Boolean(value.trim()) && !busy;
  return (
    <View>
      <Text style={nameStyles.label}>{label}</Text>
      <TextInput
        style={[nameStyles.input, error ? nameStyles.inputError : null]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.navInactive}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => canConfirm && onConfirm()}
      />
      {error ? (
        <View style={nameStyles.errorRow}>
          <Feather name="alert-circle" size={15} color={colors.danger} />
          <Text style={nameStyles.errorText}>{error}</Text>
        </View>
      ) : null}
      <View style={nameStyles.actions}>
        <Pressable onPress={onCancel} hitSlop={10} disabled={busy}>
          <Text style={nameStyles.cancel}>Annuler</Text>
        </Pressable>
        <Pressable
          style={[nameStyles.confirm, !canConfirm && nameStyles.confirmDisabled]}
          onPress={onConfirm}
          disabled={!canConfirm}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={nameStyles.confirmText}>{confirmLabel}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const nameStyles = StyleSheet.create({
  label: { ...labelText, color: colors.text2 },
  input: {
    fontFamily: fonts.serifSemiBold,
    fontSize: 24,
    letterSpacing: -0.4,
    color: colors.ink,
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderBottomColor: colors.ink,
    marginTop: 4,
  },
  inputError: { borderBottomColor: colors.danger },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 },
  errorText: { flex: 1, fontFamily: fonts.sansMedium, fontSize: 14, color: colors.danger },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 22, marginTop: 14 },
  cancel: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.text2 },
  confirm: {
    minWidth: 96,
    height: 40,
    paddingHorizontal: 20,
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDisabled: { opacity: 0.3 },
  confirmText: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.white },
});
