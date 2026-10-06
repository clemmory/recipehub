import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Image, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../context/AuthContext';
import { ApiError, importPhotos } from '../lib/api';
import { preparePhotoForAi, type AiPhoto } from '../lib/photo';
import type { ProgressStep } from '../lib/progress';
import { colors, radii, fonts } from '../lib/theme';
import ImportProgress from '../components/ImportProgress';
import {
  BottomActionBar,
  DashedTile,
  FieldLabel,
  RoundButton,
  ScreenHeading,
  SecondaryButton,
  SIDE,
} from '../components/ui';

type Nav = NativeStackNavigationProp<RootStackParamList, 'PhotoImport'>;
type Route = RouteProp<RootStackParamList, 'PhotoImport'>;

// Same cap as the API (MAX_IMPORT_PHOTOS in routes/imports.ts): a recipe
// rarely spans more than two pages, 5 leaves room for a long one.
const MAX_PHOTOS = 5;

// One page measured at ~9s (2026-09-30) — to adjust from the API's
// "[imports] photo import structured in Xms" logs after a few more imports.
const PHOTO_STEPS: ProgressStep[] = [
  { at: 0, text: 'Lecture des pages' },
  { at: 3500, text: 'Repérage des ingrédients et des quantités' },
  { at: 8000, text: 'Mise en forme des étapes' },
];

// Phase 3 — photo import (2026-09-30, redesigned 2026-10-01): photograph a
// recipe (cookbook page, magazine, handwritten card), possibly over several
// pages, and let Claude structure it. The photos only feed the AI: the
// recipe starts with a colored cover, the user adds a dish photo later.
export default function PhotoImportScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { token } = useAuth();
  const presetTag = route.params?.presetTag;
  // Set when coming from a failed Instagram import: screenshots of the post.
  const source = route.params?.source;

  const [photos, setPhotos] = useState<AiPhoto[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [structuring, setStructuring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // No swipe-back while waiting: "Annuler" is the way out.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !structuring });
  }, [navigation, structuring]);

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
      setError('Impossible de préparer la photo. Réessaie avec une autre.');
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
    const controller = new AbortController();
    abortRef.current = controller;
    setStructuring(true);
    const start = Date.now();
    try {
      const draft = await importPhotos(
        token,
        photos.map((p) => ({ photoBase64: p.base64, photoMimeType: p.mimeType })),
        controller.signal,
      );
      if (controller.signal.aborted) return;
      console.log(
        `[photo-import] ${photos.length} photo(s) structured in ${Date.now() - start}ms: "${draft.title}"${source ? ` (screenshots of ${source})` : ''}`,
      );
      if (presetTag && !draft.tags.includes(presetTag)) draft.tags = [...draft.tags, presetTag];
      navigation.replace('RecipeEdit', { draft, fromAi: true, source });
    } catch (err) {
      if (controller.signal.aborted) return;
      // No ApiError = the request never got an answer (offline, wrong
      // EXPO_PUBLIC_API_URL, API down).
      setError(
        err instanceof ApiError
          ? err.message
          : 'Connexion au serveur impossible. Vérifie ta connexion internet puis réessaie.',
      );
      setStructuring(false);
    }
  }

  function handleCancel() {
    console.log('[photo-import] cancelled while waiting');
    abortRef.current?.abort();
    abortRef.current = null;
    setStructuring(false);
  }

  if (structuring) {
    return (
      <ImportProgress
        steps={PHOTO_STEPS}
        expectedMs={photos.length > 1 ? 14000 : 10000}
        previewUri={photos[0]?.uri}
        previewBadge={{ icon: 'file-text', text: photos.length > 1 ? `${photos.length} pages` : '1 page' }}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <RoundButton icon="chevron-left" label="Retour" onPress={() => navigation.goBack()} />
        {source ? (
          <ScreenHeading
            kicker="Depuis Instagram"
            title="Depuis des captures"
            intro="Sur le post, touche « plus » pour afficher toute la légende, puis fais des captures d'écran. Une longue légende ? Ajoute toutes les captures, dans l'ordre."
          />
        ) : (
          <ScreenHeading
            kicker="Nouvelle recette"
            title="Depuis des photos"
            intro="Photographie chaque page dans l'ordre. Une recette sur deux pages ? Ajoute-les toutes les deux."
          />
        )}

        <View style={styles.block}>
          <FieldLabel right={<Text style={styles.counter}>{photos.length} / {MAX_PHOTOS}</Text>}>
            {source ? 'Captures' : 'Pages'}
          </FieldLabel>
          <View style={styles.grid}>
            {photos.map((photo, index) => (
              <View key={photo.uri} style={styles.tile}>
                <Image source={{ uri: photo.uri }} style={styles.tileImage} />
                <View style={styles.pageBadge}>
                  <Text style={styles.pageBadgeText}>{index + 1}</Text>
                </View>
                <Pressable
                  style={styles.removeTarget}
                  onPress={() => handleRemove(index)}
                  accessibilityLabel={`Retirer la page ${index + 1}`}
                >
                  <View style={styles.removeBadge}>
                    <Feather name="x" size={14} color={colors.ink} />
                  </View>
                </Pressable>
              </View>
            ))}
            {preparing ? (
              <View style={[styles.tile, styles.preparingTile]}>
                <ActivityIndicator color={colors.terracotta} />
              </View>
            ) : remaining > 0 ? (
              // Screenshots only live in the photo library: no camera then.
              <DashedTile
                vertical
                icon="plus"
                label={
                  source
                    ? photos.length > 0
                      ? 'Capture suivante'
                      : 'Choisir les captures'
                    : photos.length > 0
                      ? 'Page suivante'
                      : 'Première page'
                }
                onPress={source ? handlePickFromLibrary : handleTakePhoto}
                style={styles.tile}
              />
            ) : null}
          </View>
        </View>

        {remaining > 0 && !source && (
          <View style={styles.buttonRow}>
            <SecondaryButton icon="camera" label="Appareil photo" style={styles.flex} onPress={handleTakePhoto} disabled={preparing} />
            <SecondaryButton icon="image" label="Photothèque" style={styles.flex} onPress={handlePickFromLibrary} disabled={preparing} />
          </View>
        )}

        <View style={styles.noteRow}>
          <View style={styles.noteSwatch} />
          <Text style={styles.noteText}>
            Les photos servent seulement à lire la recette. Elle démarrera avec une couverture colorée : tu pourras ajouter
            une photo du plat plus tard.
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <BottomActionBar
        label="Lire la recette avec l'IA"
        onPress={handleStructure}
        disabled={photos.length === 0 || preparing}
      />
    </SafeAreaView>
  );
}

const TILE_GAP = 10;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  flex: { flex: 1 },
  content: { paddingHorizontal: SIDE, paddingTop: 12, paddingBottom: 32 },
  block: { marginTop: 28 },
  counter: { fontFamily: fonts.sans, fontSize: 14, color: colors.text2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: TILE_GAP, marginTop: 12 },
  tile: { width: '31.5%', height: 150 },
  tileImage: { width: '100%', height: '100%', borderRadius: radii.photo, backgroundColor: colors.surface },
  preparingTile: {
    borderRadius: radii.photo,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageBadgeText: { fontFamily: fonts.sansBold, fontSize: 12, color: colors.white },
  // 36px touch target around a 26px visual badge.
  removeTarget: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  noteRow: { flexDirection: 'row', gap: 14, marginTop: 28 },
  noteSwatch: { width: 34, height: 26, borderRadius: 6, backgroundColor: colors.terracotta, marginTop: 2 },
  noteText: { flex: 1, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20, color: colors.text2 },
  error: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.danger, marginTop: 20 },
});
