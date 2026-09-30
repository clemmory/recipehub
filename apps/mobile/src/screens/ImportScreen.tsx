import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../context/AuthContext';
import { ApiError, importInstagram, structureRecipe, type ScrapedPhotoCandidate, type StructuredRecipeDraft } from '../lib/api';
import { saveBase64PhotoToFile } from '../lib/photo';
import { useProgressMessage, type ProgressStep } from '../lib/progress';
import { colors, radii, fonts } from '../lib/theme';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Import'>;
type Route = RouteProp<RootStackParamList, 'Import'>;

type Photo = { uri: string; base64: string; mimeType: string };

// What went wrong when the automatic import didn't work — shown as a short
// title + an explanation of what to do next. Replaced (2026-09-29) a single
// "Récupération automatique impossible" that never said why.
type FetchNotice = { title: string; body: string };

const NOTICES = {
  unavailable: {
    title: "Ce post n'est pas accessible",
    body: "Son auteur en limite l'accès aux personnes connectées à Instagram, ou il a été supprimé. Copie la légende depuis l'app Instagram et colle-la ci-dessous : l'IA s'occupe du reste.",
  },
  badUrl: {
    title: "Ce lien n'est pas un post Instagram",
    body: 'Sur le post ou le Reel, utilise Partager → Copier le lien, puis colle-le ici.',
  },
  failed: {
    title: "Instagram n'a pas répondu",
    body: 'Réessaie dans un instant, ou colle la légende ci-dessous pour continuer sans attendre.',
  },
  serverError: {
    title: 'Le serveur a rencontré un problème',
    body: 'Réessaie dans un instant, ou colle la légende ci-dessous pour continuer.',
  },
  offline: {
    title: 'Connexion au serveur impossible',
    body: 'Vérifie ta connexion internet puis réessaie.',
  },
} satisfies Record<string, FetchNotice>;

// Timings measured 2026-09-29: an import takes ~8-12s, scraping ~1.5-3s,
// then Claude ~6-9s.
const IMPORT_PROGRESS: ProgressStep[] = [
  { at: 0, text: 'Lecture du post Instagram…' },
  { at: 2500, text: "L'IA lit la légende et structure la recette…" },
  { at: 9000, text: "Presque fini, l'IA met en forme les étapes…" },
  { at: 16000, text: "C'est plus long que d'habitude, encore un instant…" },
];

const STRUCTURE_PROGRESS: ProgressStep[] = [
  { at: 0, text: "L'IA structure la recette…" },
  { at: 7000, text: "Presque fini, l'IA met en forme les étapes…" },
  { at: 14000, text: "C'est plus long que d'habitude, encore un instant…" },
];

export default function ImportScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { token } = useAuth();
  const presetTag = route.params?.presetTag;

  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchNotice, setFetchNotice] = useState<FetchNotice | null>(null);

  const [caption, setCaption] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);

  const [structuring, setStructuring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importProgress = useProgressMessage(fetching, IMPORT_PROGRESS);
  const structureProgress = useProgressMessage(structuring, STRUCTURE_PROGRESS);

  // Shared by the automatic flow (the import call returns the draft) and
  // the manual "Structurer avec l'IA" button (used when the import failed
  // and the user filled the caption/photo in by hand). `candidates` carries
  // the photo choices (a carousel's images) through to RecipeEditScreen,
  // which is where the user actually picks one.
  function navigateToEdit(draft: StructuredRecipeDraft, photoValue: Photo | null, candidates?: ScrapedPhotoCandidate[]) {
    if (presetTag && !draft.tags.includes(presetTag)) draft.tags = [...draft.tags, presetTag];
    const savedPhoto = photoValue ? saveBase64PhotoToFile(photoValue.base64, photoValue.mimeType) : undefined;
    navigation.replace('RecipeEdit', {
      draft,
      source: url.trim() || undefined,
      photo: savedPhoto,
      photoCandidates: candidates && candidates.length > 0 ? candidates : undefined,
    });
  }

  async function handleFetch() {
    if (!token || !url.trim()) return;
    setError(null);
    setFetchNotice(null);
    setFetching(true);
    try {
      // One call does it all server-side: scrape + Claude structuring.
      const result = await importInstagram(token, url.trim());
      const photoValue: Photo | null =
        result.photoBase64 && result.photoMimeType
          ? {
              uri: `data:${result.photoMimeType};base64,${result.photoBase64}`,
              base64: result.photoBase64,
              mimeType: result.photoMimeType,
            }
          : null;
      if (result.caption) setCaption(result.caption);
      if (photoValue) setPhoto(photoValue);

      if (!result.scraped) {
        // 'unavailable' covers both restricted (visible only to logged-in
        // Instagram users) and deleted posts — the API can't tell which
        // from a plain fetch (2026-09-29).
        setFetchNotice(
          result.reason === 'unavailable'
            ? NOTICES.unavailable
            : result.reason === 'bad-url'
              ? NOTICES.badUrl
              : NOTICES.failed,
        );
        return;
      }

      // Scraping and structuring both worked — go straight to the structured
      // recipe, no need for the user to review the raw caption/photo.
      if (result.draft) {
        navigateToEdit(result.draft, photoValue, result.photoCandidates);
      } else {
        // Scraped but Claude failed: caption and photo are filled in above,
        // the "Structurer avec l'IA" button retries with them.
        setError("L'IA n'a pas pu structurer la recette. Réessaie avec le bouton « Structurer avec l'IA » ci-dessous.");
      }
    } catch (err) {
      // An ApiError means the server answered with an error: 400 is its URL
      // validation ("Lien invalide" — not a URL at all), anything else a
      // server-side problem. No ApiError = the request never got an answer
      // (phone offline, wrong EXPO_PUBLIC_API_URL, API down).
      setFetchNotice(
        err instanceof ApiError ? (err.status === 400 ? NOTICES.badUrl : NOTICES.serverError) : NOTICES.offline,
      );
    } finally {
      setFetching(false);
    }
  }

  function applyPickedAsset(asset: ImagePicker.ImagePickerAsset) {
    if (!asset.base64) return;
    setPhoto({ uri: asset.uri, base64: asset.base64, mimeType: asset.mimeType ?? 'image/jpeg' });
  }

  async function handlePickFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Autorisation nécessaire', "Autorise l'accès à la photothèque pour ajouter une photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, base64: true });
    if (result.canceled || result.assets.length === 0) return;
    applyPickedAsset(result.assets[0]);
  }

  async function handleTakePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Autorisation nécessaire', "Autorise l'accès à la caméra pour prendre une photo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, base64: true });
    if (result.canceled || result.assets.length === 0) return;
    applyPickedAsset(result.assets[0]);
  }

  function handleAddPhoto() {
    Alert.alert('', undefined, [
      { text: 'Prendre une photo', onPress: handleTakePhoto },
      { text: 'Choisir dans la photothèque', onPress: handlePickFromLibrary },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }

  async function handleStructure() {
    if (!token) return;
    setError(null);
    setStructuring(true);
    try {
      const draft = await structureRecipe(token, {
        caption: caption.trim() || undefined,
        photoBase64: photo?.base64,
        photoMimeType: photo?.mimeType,
      });
      navigateToEdit(draft, photo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de structurer la recette avec l'IA");
    } finally {
      setStructuring(false);
    }
  }

  const canStructure = Boolean(caption.trim() || photo);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Lien Instagram</Text>
        <View style={styles.urlRow}>
          <TextInput
            style={[styles.input, styles.urlInput]}
            value={url}
            onChangeText={setUrl}
            placeholder="https://www.instagram.com/p/..."
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Pressable style={styles.fetchButton} onPress={handleFetch} disabled={fetching || !url.trim()}>
            {fetching ? <ActivityIndicator color={colors.white} /> : <Text style={styles.fetchButtonText}>Importer</Text>}
          </Pressable>
        </View>
        {importProgress ? <Text style={styles.progressText}>{importProgress}</Text> : null}
        {fetchNotice ? (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>{fetchNotice.title}</Text>
            <Text style={styles.noticeBody}>{fetchNotice.body}</Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Légende</Text>
        <TextInput
          style={[styles.input, styles.captionInput]}
          value={caption}
          onChangeText={setCaption}
          placeholder="Colle ou modifie la légende de la recette ici..."
          multiline
        />

        <Text style={styles.sectionTitle}>Photo</Text>
        {photo ? <Image source={{ uri: photo.uri }} style={styles.photo} /> : null}
        <View style={styles.photoActions}>
          <Pressable style={styles.linkButton} onPress={handleAddPhoto}>
            <Text style={styles.linkButtonText}>{photo ? 'Changer la photo' : 'Ajouter une photo'}</Text>
          </Pressable>
          {photo && (
            <Pressable style={styles.linkButton} onPress={() => setPhoto(null)}>
              <Text style={[styles.linkButtonText, styles.removeText]}>Retirer la photo</Text>
            </Pressable>
          )}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={styles.structureButton} onPress={handleStructure} disabled={structuring || !canStructure}>
          {structuring ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.structureButtonText}>Structurer avec l'IA</Text>
          )}
        </Pressable>
        {structureProgress ? <Text style={[styles.progressText, styles.progressTextCentered]}>{structureProgress}</Text> : null}

        <Pressable
          style={styles.linkButton}
          onPress={() =>
            navigation.replace(
              'RecipeEdit',
              presetTag
                ? {
                    draft: {
                      title: '',
                      ingredients: [],
                      steps: [],
                      prepTimeMin: null,
                      cookTimeMin: null,
                      servings: null,
                      tags: [presetTag],
                    },
                  }
                : {},
            )
          }
        >
          <Text style={styles.linkButtonText}>Passer, saisie manuelle</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 16, gap: 8, paddingBottom: 48, backgroundColor: colors.cream, flexGrow: 1 },
  label: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.gray, marginTop: 8 },
  urlRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 10,
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    backgroundColor: colors.white,
    color: colors.charcoal,
  },
  urlInput: { flex: 1 },
  fetchButton: {
    backgroundColor: colors.terracotta,
    borderRadius: radii.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fetchButtonText: { fontFamily: fonts.sansSemiBold, color: colors.white, fontSize: 13 },
  progressText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.terracottaDark, marginTop: 8 },
  progressTextCentered: { textAlign: 'center' },
  noticeCard: {
    marginTop: 10,
    padding: 12,
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.terracotta,
  },
  noticeTitle: { fontFamily: fonts.sansBold, fontSize: 14, color: colors.charcoal, marginBottom: 4 },
  noticeBody: { fontFamily: fonts.sansMedium, fontSize: 13, lineHeight: 18, color: colors.gray },
  sectionTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.charcoal, marginTop: 16 },
  captionInput: { minHeight: 90, textAlignVertical: 'top' },
  photo: { width: '100%', height: 200, borderRadius: radii.lg, backgroundColor: colors.border, marginTop: 8 },
  photoActions: { flexDirection: 'row', gap: 16, marginTop: 8, marginBottom: 8 },
  linkButton: { marginTop: 10 },
  linkButtonText: { fontFamily: fonts.sansSemiBold, color: colors.greenDark },
  removeText: { color: colors.danger },
  structureButton: {
    backgroundColor: colors.terracotta,
    borderRadius: radii.md,
    padding: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  structureButtonText: { fontFamily: fonts.sansSemiBold, color: colors.white, fontSize: 16 },
  error: { fontFamily: fonts.sansMedium, color: colors.danger, marginTop: 12 },
});
