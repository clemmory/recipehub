import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  ScrollView,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../context/AuthContext';
import { ApiError, importInstagram, structureRecipe, type ScrapedPhotoCandidate, type StructuredRecipeDraft } from '../lib/api';
import { saveBase64PhotoToFile } from '../lib/photo';
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
  SmallPillButton,
  SIDE,
} from '../components/ui';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Import'>;
type Route = RouteProp<RootStackParamList, 'Import'>;

type Photo = { uri: string; base64: string; mimeType: string };

// The screen's three states (2026-10-01 redesign): paste a link → waiting
// screen → the review (RecipeEditScreen), or, when the automatic import
// didn't work, the manual fallback (paste the caption, optional photo).
type Phase = 'link' | 'waiting' | 'manual';

// What the manual fallback says about why it's showing — a title + what to
// do next, one per cause (2026-09-29, kept in the redesign).
type Notice = { kicker: string; alert: boolean; title: string; body: string };

const NOTICES = {
  unavailable: {
    kicker: 'Import impossible',
    alert: true,
    title: "On n'a pas pu lire ce post",
    body: "Le compte est peut-être privé, ou Instagram a bloqué la lecture. Pas de souci : fais des captures d'écran de la légende, l'IA s'occupe du reste.",
  },
  badUrl: {
    kicker: 'Import impossible',
    alert: true,
    title: "Ce lien n'est pas un post Instagram",
    body: 'Sur le post ou le Reel, touche Partager puis Copier le lien. Ou colle directement la légende ci-dessous.',
  },
  failed: {
    kicker: 'Import impossible',
    alert: true,
    title: "Instagram n'a pas répondu",
    body: "Réessaie dans un instant, ou fais des captures d'écran de la légende : l'IA s'occupe du reste.",
  },
  aiFailed: {
    kicker: 'Import interrompu',
    alert: true,
    title: "L'IA n'a pas pu mettre en forme la recette",
    body: 'Le post a bien été lu : sa légende et sa photo sont ci-dessous. Relance la mise en forme, en corrigeant la légende si besoin.',
  },
  serverError: {
    kicker: 'Import impossible',
    alert: true,
    title: 'Le serveur a rencontré un problème',
    body: "Réessaie dans un instant, ou fais des captures d'écran de la légende pour continuer.",
  },
  offline: {
    kicker: 'Import impossible',
    alert: true,
    title: 'Connexion au serveur impossible',
    body: 'Vérifie ta connexion internet puis réessaie.',
  },
  // No link at all: "Pas de lien ?" on the first step.
  noLink: {
    kicker: 'Nouvelle recette',
    alert: false,
    title: 'Depuis une légende',
    body: "Colle le texte de la recette : ingrédients, étapes… L'IA s'occupe de la mise en forme.",
  },
} satisfies Record<string, Notice>;

// Same pattern as the API's extractShortcode (instagramScraper.ts): checked
// locally to say right away whether the pasted link looks right.
const INSTAGRAM_POST_RE = /instagram\.com\/(?:[^/?#]+\/)?(p|reel|reels|tv)\/[A-Za-z0-9_-]+/;

// Timings measured 2026-09-29: an import takes ~8-12s — scraping ~1.5s,
// then Claude ~6-9s. The last step is only checked by the real answer.
const IMPORT_STEPS: ProgressStep[] = [
  { at: 0, text: 'Lecture du post Instagram' },
  { at: 1200, text: 'Récupération de la photo' },
  { at: 2500, text: 'Repérage des ingrédients et des quantités' },
  { at: 7500, text: 'Mise en forme des étapes' },
];

function structureSteps(hasCaption: boolean, hasPhoto: boolean): ProgressStep[] {
  return [
    {
      at: 0,
      text: hasCaption && hasPhoto ? 'Lecture de la légende et de la photo' : hasPhoto ? 'Lecture de la photo' : 'Lecture de la légende',
    },
    { at: 1500, text: 'Repérage des ingrédients et des quantités' },
    { at: 6000, text: 'Mise en forme des étapes' },
  ];
}

export default function ImportScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { token } = useAuth();
  const presetTag = route.params?.presetTag;

  const [phase, setPhase] = useState<Phase>('link');
  const [waitingFor, setWaitingFor] = useState<'import' | 'structure'>('import');
  const [url, setUrl] = useState('');
  const [urlFocused, setUrlFocused] = useState(false);
  const [notice, setNotice] = useState<Notice>(NOTICES.unavailable);

  const [caption, setCaption] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The call in flight — "Annuler" aborts it (and leaving the screen too).
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // No swipe-back while waiting: "Annuler" is the way out.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: phase !== 'waiting' });
  }, [navigation, phase]);

  const trimmedUrl = url.trim();
  const urlLooksRight = INSTAGRAM_POST_RE.test(trimmedUrl);

  // Shared by the automatic flow (the import call returns the draft) and
  // the manual fallback. `candidates` carries a carousel's images through to
  // RecipeEditScreen, which is where the user actually picks one.
  function navigateToEdit(draft: StructuredRecipeDraft, photoValue: Photo | null, candidates?: ScrapedPhotoCandidate[]) {
    if (presetTag && !draft.tags.includes(presetTag)) draft.tags = [...draft.tags, presetTag];
    const savedPhoto = photoValue ? saveBase64PhotoToFile(photoValue.base64, photoValue.mimeType) : undefined;
    navigation.replace('RecipeEdit', {
      draft,
      fromAi: true,
      source: trimmedUrl || undefined,
      photo: savedPhoto,
      photoCandidates: candidates && candidates.length > 0 ? candidates : undefined,
    });
  }

  function showManual(next: Notice) {
    setNotice(next);
    setPhase('manual');
  }

  async function handleImport() {
    if (!token || !urlLooksRight) return;
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setWaitingFor('import');
    setPhase('waiting');
    const start = Date.now();
    try {
      // One call does it all server-side: scrape + Claude structuring.
      const result = await importInstagram(token, trimmedUrl, controller.signal);
      if (controller.signal.aborted) return;
      console.log(
        `[import] answered in ${Date.now() - start}ms: scraped=${result.scraped} draft=${Boolean(result.draft)} reason=${result.reason ?? '-'}`,
      );
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
        showManual(
          result.reason === 'unavailable'
            ? NOTICES.unavailable
            : result.reason === 'bad-url'
              ? NOTICES.badUrl
              : NOTICES.failed,
        );
        return;
      }
      if (result.draft) {
        navigateToEdit(result.draft, photoValue, result.photoCandidates);
      } else {
        // Scraped but Claude failed: caption and photo are filled in above,
        // "Mettre en forme avec l'IA" retries with them.
        showManual(NOTICES.aiFailed);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      // An ApiError means the server answered with an error: 400 is its URL
      // validation, anything else a server-side problem. No ApiError = the
      // request never got an answer (phone offline, wrong
      // EXPO_PUBLIC_API_URL, API down).
      showManual(
        err instanceof ApiError ? (err.status === 400 ? NOTICES.badUrl : NOTICES.serverError) : NOTICES.offline,
      );
    }
  }

  async function handleStructure() {
    if (!token || !canStructure) return;
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setWaitingFor('structure');
    setPhase('waiting');
    try {
      const draft = await structureRecipe(
        token,
        {
          caption: caption.trim() || undefined,
          photoBase64: photo?.base64,
          photoMimeType: photo?.mimeType,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      navigateToEdit(draft, photo);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        err instanceof ApiError
          ? err.message
          : 'Connexion au serveur impossible. Vérifie ta connexion internet puis réessaie.',
      );
      setPhase('manual');
    }
  }

  function handleCancel() {
    console.log(`[import] cancelled while waiting (${waitingFor})`);
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase(waitingFor === 'import' ? 'link' : 'manual');
  }

  async function pasteInto(setter: (text: string) => void) {
    const text = await Clipboard.getStringAsync();
    if (text) setter(text.trim());
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
      { text: 'Choisir dans la photothèque', onPress: handlePickFromLibrary },
      { text: 'Prendre une photo', onPress: handleTakePhoto },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }

  const canStructure = Boolean(caption.trim() || photo);

  if (phase === 'waiting') {
    return waitingFor === 'import' ? (
      <ImportProgress steps={IMPORT_STEPS} expectedMs={10000} onCancel={handleCancel} />
    ) : (
      <ImportProgress
        steps={structureSteps(Boolean(caption.trim()), Boolean(photo))}
        expectedMs={8000}
        previewUri={photo?.uri}
        previewBadge={{ icon: 'image', text: 'Photo ajoutée' }}
        onCancel={handleCancel}
      />
    );
  }

  if (phase === 'manual') {
    const hasLink = notice !== NOTICES.noLink && urlLooksRight;
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <RoundButton icon="chevron-left" label="Retour" onPress={() => setPhase('link')} />
            <ScreenHeading
              kicker={notice.kicker}
              kickerIcon={notice.alert ? 'alert-circle' : undefined}
              title={notice.title}
              intro={notice.body}
            />

            {hasLink && (
              <>
                <View style={styles.buttonRow}>
                  <SecondaryButton
                    icon="instagram"
                    label="Ouvrir le post"
                    style={styles.flex}
                    onPress={() =>
                      Linking.openURL(trimmedUrl.startsWith('http') ? trimmedUrl : `https://${trimmedUrl}`).catch(() =>
                        Alert.alert('Impossible', "Le post n'a pas pu être ouvert."),
                      )
                    }
                  />
                  <SecondaryButton icon="rotate-cw" label="Réessayer" style={styles.flex} onPress={handleImport} />
                </View>
                <View style={styles.inkRule} />

                {/* Instagram doesn't let you copy a caption (found on device
                    2026-10-06), so screenshots of it are the main way out:
                    the photo import reads them like the pages of a book. */}
                <View style={styles.block}>
                  <FieldLabel>Le plus simple</FieldLabel>
                  <DashedTile
                    icon="image"
                    label="Importer des captures de la légende"
                    onPress={() => {
                      console.log(`[import] fallback to screenshots for ${trimmedUrl}`);
                      navigation.navigate('PhotoImport', { presetTag, source: trimmedUrl });
                    }}
                    style={styles.tile}
                  />
                </View>
              </>
            )}

            <View style={styles.block}>
              <FieldLabel right={<SmallPillButton label="Coller" onPress={() => pasteInto(setCaption)} />}>
                {hasLink ? 'Ou colle la légende' : 'Légende du post'}
              </FieldLabel>
              <TextInput
                style={styles.captionInput}
                value={caption}
                onChangeText={setCaption}
                placeholder="Colle ici le texte de la recette : ingrédients, étapes…"
                placeholderTextColor={colors.navInactive}
                multiline
              />
            </View>

            <View style={styles.block}>
              <FieldLabel>
                Photo du plat <Text style={styles.optional}>(facultatif)</Text>
              </FieldLabel>
              {photo ? (
                <>
                  <Image source={{ uri: photo.uri }} style={styles.photo} />
                  <View style={styles.photoLinks}>
                    <Pressable onPress={handleAddPhoto} hitSlop={6}>
                      <Text style={styles.photoLink}>Changer la photo</Text>
                    </Pressable>
                    <Pressable onPress={() => setPhoto(null)} hitSlop={6}>
                      <Text style={styles.photoLink}>Retirer</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <DashedTile icon="camera" label="Ajouter une capture du post" onPress={handleAddPhoto} style={styles.tile} />
              )}
              <Text style={styles.note}>
                Sans photo, la recette aura une couverture colorée.
                {hasLink ? ' Le lien reste enregistré comme source.' : ''}
              </Text>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
          <BottomActionBar label="Mettre en forme avec l'IA" onPress={handleStructure} disabled={!canStructure} />
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <RoundButton icon="chevron-left" label="Retour" onPress={() => navigation.goBack()} />
          <ScreenHeading
            kicker="Nouvelle recette"
            title="Depuis Instagram"
            intro="Colle le lien d'un post ou d'un Reel. Le texte et la photo sont récupérés, puis l'IA met la recette en forme."
          />

          <View style={styles.block}>
            <FieldLabel>Lien du post</FieldLabel>
            <View style={[styles.urlField, (urlFocused || trimmedUrl) && styles.urlFieldActive]}>
              <TextInput
                style={styles.urlInput}
                value={url}
                onChangeText={setUrl}
                onFocus={() => setUrlFocused(true)}
                onBlur={() => setUrlFocused(false)}
                placeholder="instagram.com/p/…"
                placeholderTextColor={colors.navInactive}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                onSubmitEditing={handleImport}
              />
              <SmallPillButton label="Coller" onPress={() => pasteInto(setUrl)} />
            </View>
            {trimmedUrl ? (
              urlLooksRight ? (
                <View style={styles.validation}>
                  <Feather name="check" size={16} color={colors.green} />
                  <Text style={[styles.validationText, { color: colors.green }]}>Lien Instagram reconnu</Text>
                </View>
              ) : (
                <View style={styles.validation}>
                  <Feather name="alert-circle" size={15} color={colors.terracottaText} />
                  <Text style={[styles.validationText, { color: colors.terracottaText }]}>
                    Ce lien ne ressemble pas à un post Instagram
                  </Text>
                </View>
              )
            ) : null}
          </View>

          {/* The design's « Plus rapide : Partager puis Tambo » note waits for
              the native share intent (Phase 2 slice 2, on hold) — hidden
              until then. */}

          <Pressable style={styles.noLink} onPress={() => showManual(NOTICES.noLink)} hitSlop={6}>
            <Text style={styles.noLinkText}>Pas de lien ? Colle directement la légende</Text>
          </Pressable>
        </ScrollView>
        <BottomActionBar label="Importer la recette" onPress={handleImport} disabled={!urlLooksRight} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  flex: { flex: 1 },
  content: { paddingHorizontal: SIDE, paddingTop: 12, paddingBottom: 32 },
  block: { marginTop: 28 },
  urlField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    paddingVertical: 8,
    marginTop: 6,
  },
  urlFieldActive: { borderBottomWidth: 2, borderBottomColor: colors.ink },
  urlInput: { flex: 1, fontFamily: fonts.sans, fontSize: 17, color: colors.ink, paddingVertical: 6 },
  validation: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  validationText: { fontFamily: fonts.sansMedium, fontSize: 14 },
  noLink: { marginTop: 28, alignSelf: 'flex-start' },
  noLinkText: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.text2, textDecorationLine: 'underline' },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
  inkRule: { height: 1, backgroundColor: colors.ink, marginTop: 28 },
  captionInput: {
    marginTop: 10,
    minHeight: 170,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.md,
    padding: 14,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 21,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  optional: { textTransform: 'none', letterSpacing: 0, fontFamily: fonts.sansMedium },
  tile: { marginTop: 10 },
  photo: { width: '100%', height: 200, borderRadius: radii.photo, backgroundColor: colors.surface, marginTop: 10 },
  photoLinks: { flexDirection: 'row', gap: 20, marginTop: 10 },
  photoLink: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.terracottaText },
  note: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, color: colors.text2, marginTop: 10 },
  error: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.danger, marginTop: 20 },
});
