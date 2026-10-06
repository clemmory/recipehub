import { useCallback, useMemo, useState } from 'react';
import { View, Text, Image, ScrollView, Pressable, StyleSheet, ActivityIndicator, Alert, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../context/AuthContext';
import {
  deleteRecipe,
  getRecipe,
  recipeInputFrom,
  resolveUrl,
  setFavorite,
  updateRecipe,
  type RecipeDetail,
} from '../lib/api';
import { colors, fonts, labelText } from '../lib/theme';
import { groupBySection } from '../lib/ingredients';
import RecipeCover from '../components/RecipeCover';

type Nav = NativeStackNavigationProp<RootStackParamList, 'RecipeDetail'>;
type Route = RouteProp<RootStackParamList, 'RecipeDetail'>;

const SIDE = 20;

function RoundButton({
  icon,
  onPress,
  label,
  busy,
  iconSet = 'feather',
  color = colors.ink,
}: {
  icon: string;
  onPress: () => void;
  label: string;
  busy?: boolean;
  iconSet?: 'feather' | 'ionicons';
  color?: string;
}) {
  return (
    <Pressable style={styles.roundButton} onPress={onPress} disabled={busy} accessibilityLabel={label}>
      {busy ? (
        <ActivityIndicator size="small" color={colors.ink} />
      ) : iconSet === 'ionicons' ? (
        <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={20} color={color} />
      ) : (
        <Feather name={icon as keyof typeof Feather.glyphMap} size={20} color={color} />
      )}
    </Pressable>
  );
}

function TimeCell({ label, value, unit, last }: { label: string; value: number | null; unit?: string; last?: boolean }) {
  return (
    <View style={[styles.timeCell, !last && styles.timeCellDivider]}>
      <Text style={styles.timeLabel}>{label}</Text>
      <Text style={styles.timeValue}>
        {value ?? '—'}
        {value != null && unit ? <Text style={styles.timeUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

export default function RecipeDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Ingredients ticked off while cooking — local only, not saved.
  const [checked, setChecked] = useState<Set<number>>(new Set());

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      let cancelled = false;
      setLoading(true);
      getRecipe(token, route.params.recipeId)
        .then((data) => {
          if (!cancelled) setRecipe(data);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Impossible de charger la recette');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [token, route.params.recipeId]),
  );

  // Groups consecutive ingredients sharing the same section (e.g. "Pour la
  // pâte") so the same ingredient can appear more than once in the list
  // (different section, different quantity) without looking like a
  // duplicate — see NOTES.md, 2026-09-11. `groupBySection` first gathers
  // each section's items together so a section title is shown only once
  // even if the list came back interleaved (2026-09-29).
  const ingredientGroups = useMemo(() => {
    const groups: { section: string | null; items: (RecipeDetail['ingredients'][number] & { key: number })[] }[] = [];
    groupBySection(recipe?.ingredients ?? []).forEach((ing, key) => {
      const last = groups[groups.length - 1];
      if (last && last.section === ing.section) {
        last.items.push({ ...ing, key });
      } else {
        groups.push({ section: ing.section, items: [{ ...ing, key }] });
      }
    });
    return groups;
  }, [recipe]);

  function toggleChecked(key: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleDelete() {
    if (!token || !recipe) return;
    Alert.alert('Supprimer la recette', `Supprimer « ${recipe.title} » ? Cette action est irréversible.`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          await deleteRecipe(token, recipe.id);
          navigation.goBack();
        },
      },
    ]);
  }

  async function handleToggleFavorite() {
    if (!token || !recipe) return;
    const next = !recipe.favorite;
    // Optimistic — reverted if the call fails.
    setRecipe({ ...recipe, favorite: next });
    try {
      await setFavorite(token, recipe.id, next);
    } catch (err) {
      console.log('[detail] favorite toggle failed', err);
      setRecipe((r) => (r ? { ...r, favorite: !next } : r));
      Alert.alert('Erreur', err instanceof Error ? err.message : 'Impossible de modifier les favoris');
    }
  }

  function handleMenu() {
    if (!recipe) return;
    Alert.alert('', undefined, [
      { text: 'Modifier', onPress: () => navigation.navigate('RecipeEdit', { recipeId: recipe.id }) },
      // Without a photo the header's heart gives way to the camera button, so
      // the favorite toggle lives here instead.
      ...(!recipe.photoUrl
        ? [{ text: recipe.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris', onPress: handleToggleFavorite }]
        : []),
      { text: 'Supprimer', style: 'destructive' as const, onPress: handleDelete },
      { text: 'Annuler', style: 'cancel' as const },
    ]);
  }

  // "Ajouter une photo du plat" straight from the recipe, without going
  // through the edit form — PUT /recipes/:id needs the whole recipe, rebuilt
  // from what's loaded.
  async function uploadDishPhoto(asset: ImagePicker.ImagePickerAsset) {
    if (!token || !recipe) return;
    setUploadingPhoto(true);
    try {
      const updated = await updateRecipe(token, recipe.id, {
        ...recipeInputFrom(recipe),
        photo: {
          uri: asset.uri,
          name: asset.fileName ?? `photo-${Date.now()}.jpg`,
          type: asset.mimeType ?? 'image/jpeg',
        },
      });
      setRecipe(updated);
    } catch (err) {
      console.log('[detail] dish photo upload failed', err);
      Alert.alert('Erreur', err instanceof Error ? err.message : "Impossible d'ajouter la photo");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function pickDishPhoto(source: 'camera' | 'library') {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Autorisation nécessaire',
        source === 'camera'
          ? "Autorise l'accès à la caméra pour prendre une photo du plat."
          : "Autorise l'accès à la photothèque pour ajouter une photo du plat.",
      );
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || result.assets.length === 0) return;
    await uploadDishPhoto(result.assets[0]);
  }

  function handleAddDishPhoto() {
    Alert.alert('', undefined, [
      { text: 'Prendre une photo', onPress: () => pickDishPhoto('camera') },
      { text: 'Choisir dans la photothèque', onPress: () => pickDishPhoto('library') },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }

  if (loading && !recipe) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !recipe) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Recette introuvable'}</Text>
      </View>
    );
  }

  const tagLine = recipe.tags.join(' · ');
  const sourceIsUrl = recipe.source ? /^https?:\/\//i.test(recipe.source) : false;
  const sourceIsInstagram = recipe.source ? /instagram\.com/i.test(recipe.source) : false;
  const hasTimes = recipe.prepTimeMin != null || recipe.cookTimeMin != null || recipe.servings != null;

  const sourceLink = sourceIsUrl ? (
    <Pressable style={styles.sourceLink} onPress={() => Linking.openURL(recipe.source!)} hitSlop={8}>
      <Feather name={sourceIsInstagram ? 'instagram' : 'external-link'} size={14} color={colors.text2} />
      <Text style={styles.sourceLinkText}>Source</Text>
    </Pressable>
  ) : null;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {recipe.photoUrl ? (
          <>
            <Image
              source={{ uri: resolveUrl(recipe.photoUrl), headers: { Authorization: `Bearer ${token}` } }}
              style={styles.heroPhoto}
            />
            <View style={styles.body}>
              <View style={styles.headRow}>
                <Text style={[labelText, styles.flex1]} numberOfLines={2}>
                  {tagLine}
                </Text>
                {sourceLink}
              </View>
              <Text style={styles.title}>{recipe.title}</Text>
            </View>
          </>
        ) : (
          <>
            <RecipeCover
              tags={recipe.tags}
              iconSize={64}
              style={[styles.heroCover, { paddingTop: insets.top + 72 }]}
            >
              {tagLine ? <Text style={[labelText, styles.coverTags]}>{tagLine}</Text> : null}
              <Text style={styles.coverTitle}>{recipe.title}</Text>
            </RecipeCover>
            {sourceLink ? <View style={[styles.body, styles.sourceRowAlone]}>{sourceLink}</View> : null}
          </>
        )}

        <View style={styles.body}>
          {recipe.source && !sourceIsUrl ? <Text style={styles.plainSource}>Source : {recipe.source}</Text> : null}

          {hasTimes && (
            <View style={styles.timeBlock}>
              <TimeCell label="Prépa" value={recipe.prepTimeMin} unit="min" />
              <TimeCell label="Cuisson" value={recipe.cookTimeMin} unit="min" />
              <TimeCell label="Parts" value={recipe.servings} last />
            </View>
          )}

          <Text style={styles.sectionTitle}>Ingrédients</Text>
          {ingredientGroups.map((group, gi) => (
            <View key={gi}>
              {group.section ? <Text style={[labelText, styles.ingredientSection]}>{group.section}</Text> : null}
              {group.items.map((ing) => {
                const done = checked.has(ing.key);
                return (
                  <Pressable
                    key={ing.key}
                    style={styles.ingredientRow}
                    onPress={() => toggleChecked(ing.key)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: done }}
                  >
                    <Text style={[styles.ingredientQty, done && styles.done]}>{ing.quantity ?? ''}</Text>
                    <Text style={[styles.ingredientName, done && styles.done]}>{ing.name}</Text>
                    <View style={[styles.checkbox, done && styles.checkboxOn]}>
                      {done && <Feather name="check" size={14} color={colors.white} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}

          <Text style={styles.sectionTitle}>Préparation</Text>
          {recipe.steps.map((step, i) => (
            <View key={i} style={styles.step}>
              <Text style={styles.stepNumber}>{i + 1}</Text>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.floatingBar, { top: insets.top + 8 }]} pointerEvents="box-none">
        <RoundButton icon="chevron-left" label="Retour" onPress={() => navigation.goBack()} />
        <View style={styles.floatingRight}>
          {recipe.photoUrl ? (
            <RoundButton
              icon={recipe.favorite ? 'heart' : 'heart-outline'}
              iconSet="ionicons"
              color={recipe.favorite ? colors.terracotta : colors.ink}
              label={recipe.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              onPress={handleToggleFavorite}
            />
          ) : (
            <RoundButton
              icon="camera"
              label="Ajouter une photo du plat"
              onPress={handleAddDishPhoto}
              busy={uploadingPhoto}
            />
          )}
          <RoundButton icon="more-horizontal" label="Plus d'actions" onPress={handleMenu} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  flex1: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.white },
  scroll: { paddingBottom: 48 },
  heroPhoto: { width: '100%', height: 400 },
  heroCover: { minHeight: 360, paddingHorizontal: SIDE, paddingBottom: 28 },
  coverTags: { color: 'rgba(255,255,255,0.85)', marginTop: 14 },
  coverTitle: {
    fontFamily: fonts.serifSemiBold,
    fontSize: 42,
    lineHeight: 44,
    letterSpacing: -1.26,
    color: colors.white,
    marginTop: 6,
  },
  body: { paddingHorizontal: SIDE },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 20 },
  sourceRowAlone: { alignItems: 'flex-end', marginTop: 16 },
  sourceLink: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sourceLinkText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.text2 },
  plainSource: { fontFamily: fonts.sans, fontSize: 14, color: colors.text2, marginTop: 16 },
  title: {
    fontFamily: fonts.serifSemiBold,
    fontSize: 36,
    lineHeight: 39,
    letterSpacing: -1.08,
    color: colors.ink,
    marginTop: 8,
  },
  timeBlock: {
    flexDirection: 'row',
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  timeCell: { flex: 1, paddingVertical: 14, paddingLeft: 12 },
  timeCellDivider: { borderRightWidth: 1, borderRightColor: colors.hairline },
  timeLabel: { ...labelText, fontSize: 10.5, color: colors.text2 },
  timeValue: { fontFamily: fonts.serifSemiBold, fontSize: 24, color: colors.ink, marginTop: 4 },
  timeUnit: { fontFamily: fonts.sans, fontSize: 13, color: colors.ink },
  sectionTitle: {
    fontFamily: fonts.serifSemiBold,
    fontSize: 26,
    letterSpacing: -0.52,
    color: colors.ink,
    marginTop: 36,
    marginBottom: 12,
  },
  ingredientSection: { marginTop: 18, marginBottom: 4 },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  ingredientQty: {
    width: 92,
    paddingRight: 8,
    fontFamily: fonts.sansBold,
    fontSize: 15,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  ingredientName: { flex: 1, fontFamily: fonts.sans, fontSize: 15, color: colors.ink },
  done: { color: colors.checked, textDecorationLine: 'line-through' },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  checkboxOn: { backgroundColor: colors.ink },
  step: { flexDirection: 'row', marginBottom: 20 },
  stepNumber: {
    width: 44,
    fontFamily: fonts.serifSemiBold,
    fontSize: 34,
    lineHeight: 38,
    color: colors.terracotta,
  },
  stepText: { flex: 1, fontFamily: fonts.sans, fontSize: 16, lineHeight: 25, color: colors.ink, paddingTop: 4 },
  floatingBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  floatingRight: { flexDirection: 'row', gap: 10 },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  error: { fontFamily: fonts.sansMedium, color: colors.danger },
});
