import { useState } from 'react';
import { View, Text, Pressable, Image, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../context/AuthContext';
import { ApiError, importPhotos } from '../lib/api';
import { preparePhotoForAi, type AiPhoto } from '../lib/photo';
import { useProgressMessage, type ProgressStep } from '../lib/progress';
import { colors, radii, fonts } from '../lib/theme';

type Nav = NativeStackNavigationProp<RootStackParamList, 'PhotoImport'>;
type Route = RouteProp<RootStackParamList, 'PhotoImport'>;

// Same cap as the API (MAX_IMPORT_PHOTOS in routes/imports.ts): a recipe
// rarely spans more than two pages, 5 leaves room for a long one.
const MAX_PHOTOS = 5;

// Estimated, not measured yet (2026-09-30): Claude reads every page and
// rewrites the whole recipe — to adjust from the API's "[imports] photo
// import structured in Xms" logs after a few real imports.
const PHOTO_PROGRESS: ProgressStep[] = [
  { at: 0, text: "L'IA lit les photos…" },
  { at: 4000, text: "L'IA structure la recette…" },
  { at: 12000, text: "Presque fini, l'IA met en forme les étapes…" },
  { at: 22000, text: "C'est plus long que d'habitude, encore un instant…" },
];

// Phase 3 — photo import (2026-09-30): photograph a recipe (cookbook page,
// magazine, handwritten card), possibly over several pages, and let Claude
// structure it. The photos only feed the AI: the recipe starts without a
// photo (placeholder on the list), the user adds a dish photo later.
export default function PhotoImportScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { token } = useAuth();
  const presetTag = route.params?.presetTag;

  const [photos, setPhotos] = useState<AiPhoto[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [structuring, setStructuring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const progress = useProgressMessage(structuring, PHOTO_PROGRESS);
  const remaining = MAX_PHOTOS - photos.length;

  async function addAssets(assets: ImagePicker.ImagePickerAsset[]) {
    setError(null);
    setPreparing(true);
    try {
      // Sequential on purpose: resizing several 12 MP photos at once can
      // spike memory on older phones, and it's well under a second each.
      const prepared: AiPhoto[] = [];
      for (const asset of assets.slice(0, remaining)) {
        prepared.push(await preparePhotoForAi(asset));
      }
      setPhotos((current) => [...current, ...prepared].slice(0, MAX_PHOTOS));
    } catch (err) {
      console.log(`[photo-import] preparing photos failed: ${(err as Error).message}`);
      setError("Impossible de préparer la photo. Réessaie avec une autre.");
    } finally {
      setPreparing(false);
    }
  }

  async function handleTakePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Autorisation nécessaire', "Autorise l'accès à la caméra pour photographier la recette.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || result.assets.length === 0) return;
    await addAssets(result.assets);
  }

  async function handlePickFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Autorisation nécessaire', "Autorise l'accès à la photothèque pour choisir les photos de la recette.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      // Pages come back in the order they were tapped, not the library's.
      orderedSelection: true,
    });
    if (result.canceled || result.assets.length === 0) return;
    await addAssets(result.assets);
  }

  function handleRemove(index: number) {
    setPhotos((current) => current.filter((_, i) => i !== index));
  }

  async function handleStructure() {
    if (!token || photos.length === 0) return;
    setError(null);
    setStructuring(true);
    const start = Date.now();
    try {
      const draft = await importPhotos(
        token,
        photos.map((p) => ({ photoBase64: p.base64, photoMimeType: p.mimeType })),
      );
      console.log(`[photo-import] ${photos.length} photo(s) structured in ${Date.now() - start}ms: "${draft.title}"`);
      if (presetTag && !draft.tags.includes(presetTag)) draft.tags = [...draft.tags, presetTag];
      navigation.replace('RecipeEdit', { draft });
    } catch (err) {
      // No ApiError = the request never got an answer (offline, wrong
      // EXPO_PUBLIC_API_URL, API down).
      setError(
        err instanceof ApiError
          ? err.message
          : 'Connexion au serveur impossible. Vérifie ta connexion internet puis réessaie.',
      );
    } finally {
      setStructuring(false);
    }
  }

  const busy = preparing || structuring;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.intro}>
        Photographie la recette : page de livre, magazine, fiche écrite à la main… Si elle tient sur plusieurs pages,
        ajoute-les dans l'ordre ({MAX_PHOTOS} maximum).
      </Text>

      {photos.length > 0 ? (
        <View style={styles.grid}>
          {photos.map((photo, index) => (
            <View key={photo.uri} style={styles.tile}>
              <Image source={{ uri: photo.uri }} style={styles.tileImage} />
              <View style={styles.pageBadge}>
                <Text style={styles.pageBadgeText}>{index + 1}</Text>
              </View>
              {!structuring && (
                <Pressable style={styles.removeBadge} onPress={() => handleRemove(index)} hitSlop={8}>
                  <Feather name="x" size={14} color={colors.white} />
                </Pressable>
              )}
            </View>
          ))}
        </View>
      ) : null}

      {preparing ? (
        <View style={styles.preparingRow}>
          <ActivityIndicator color={colors.terracotta} />
          <Text style={styles.progressText}>Préparation des photos…</Text>
        </View>
      ) : null}

      {remaining > 0 ? (
        <View style={styles.addRow}>
          <Pressable style={styles.addButton} onPress={handleTakePhoto} disabled={busy}>
            <Feather name="camera" size={18} color={colors.terracotta} />
            <Text style={styles.addButtonText}>{photos.length > 0 ? 'Page suivante' : 'Prendre une photo'}</Text>
          </Pressable>
          <Pressable style={styles.addButton} onPress={handlePickFromLibrary} disabled={busy}>
            <Feather name="image" size={18} color={colors.terracotta} />
            <Text style={styles.addButtonText}>Photothèque</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.structureButton, (photos.length === 0 || busy) && styles.structureButtonDisabled]}
        onPress={handleStructure}
        disabled={photos.length === 0 || busy}
      >
        {structuring ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.structureButtonText}>Lire la recette avec l'IA</Text>
        )}
      </Pressable>
      {progress ? <Text style={[styles.progressText, styles.progressTextCentered]}>{progress}</Text> : null}

      <Text style={styles.footnote}>
        Les photos servent seulement à lire la recette, elles ne deviennent pas sa photo : tu pourras en ajouter une du
        plat ensuite.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 8, paddingBottom: 48, backgroundColor: colors.cream, flexGrow: 1 },
  intro: { fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 20, color: colors.gray },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  tile: { width: '31%', aspectRatio: 3 / 4 },
  tileImage: { width: '100%', height: '100%', borderRadius: radii.md, backgroundColor: colors.border },
  pageBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageBadgeText: { fontFamily: fonts.sansBold, fontSize: 12, color: colors.white },
  removeBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(38, 34, 32, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  preparingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  addRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  addButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.terracotta,
    backgroundColor: colors.white,
  },
  addButtonText: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.terracotta },
  error: { fontFamily: fonts.sansMedium, color: colors.danger, marginTop: 12 },
  structureButton: {
    backgroundColor: colors.terracotta,
    borderRadius: radii.md,
    padding: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  structureButtonDisabled: { opacity: 0.5 },
  structureButtonText: { fontFamily: fonts.sansSemiBold, color: colors.white, fontSize: 16 },
  progressText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.terracottaDark },
  progressTextCentered: { textAlign: 'center', marginTop: 8 },
  footnote: { fontFamily: fonts.sansMedium, fontSize: 12, lineHeight: 17, color: colors.gray, marginTop: 24 },
});
