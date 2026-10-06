import { useEffect, useMemo, useRef, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useNavigation, usePreventRemove, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../context/AuthContext';
import {
  createRecipe,
  getRecipe,
  listTags,
  resolveUrl,
  updateRecipe,
  type RecipeIngredient,
  type ScrapedPhotoCandidate,
  type Tag,
} from '../lib/api';
import { saveBase64PhotoToFile } from '../lib/photo';
import { colors, radii, fonts } from '../lib/theme';
import { groupBySection } from '../lib/ingredients';
import { BottomActionBar, DashedTile, FieldLabel, InfoNote, RoundButton, SIDE } from '../components/ui';

type Nav = NativeStackNavigationProp<RootStackParamList, 'RecipeEdit'>;
type Route = RouteProp<RootStackParamList, 'RecipeEdit'>;

type PickedPhoto = { uri: string; name: string; type: string };

function capitalizeFirst(text: string) {
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}

function buildFormSnapshot(fields: {
  title: string;
  servings: string;
  prepTimeMin: string;
  cookTimeMin: string;
  steps: string[];
  ingredients: RecipeIngredient[];
  tagsText: string;
  source: string;
}) {
  return JSON.stringify(fields);
}

// Create, edit, and review an AI import ("Relecture") — one screen, laid
// out in the "blanc éditorial" style on 2026-10-01: underlined fields,
// collection chips, ingredient/step rows between hairlines, fixed save bar.
export default function RecipeEditScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { token } = useAuth();
  const recipeId = route.params?.recipeId;
  const isEditing = Boolean(recipeId);
  const fromAi = Boolean(route.params?.fromAi);

  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [servings, setServings] = useState('');
  const [prepTimeMin, setPrepTimeMin] = useState('');
  const [cookTimeMin, setCookTimeMin] = useState('');
  const [steps, setSteps] = useState<string[]>(['']);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([{ name: '', quantity: '', section: null }]);
  const [tagsText, setTagsText] = useState('');
  const [existingTags, setExistingTags] = useState<Tag[]>([]);
  const [existingTagsLoaded, setExistingTagsLoaded] = useState(false);
  const [source, setSource] = useState('');
  // « + Nouvelle » collection chip → inline name field.
  const [addingTag, setAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null);
  const [newPhoto, setNewPhoto] = useState<PickedPhoto | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  // A carousel's images (Instagram import) — the first one arrives as the
  // photo, the others are thumbnails under it (2026-10-01, replaced the
  // "Changer Photo" tile picker). `selectedCandidate` = the ringed one, null
  // once the user picked a photo of their own.
  const [photoCandidates, setPhotoCandidates] = useState<ScrapedPhotoCandidate[] | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<number | null>(null);

  const initialSnapshotRef = useRef<string | null>(null);
  // Set once saved: a new recipe opens its detail screen, an edit goes back.
  const [saved, setSaved] = useState<{ createdId: string | null } | null>(null);

  useEffect(() => {
    if (!token) return;
    listTags(token)
      .then(setExistingTags)
      .catch(() => undefined)
      .finally(() => setExistingTagsLoaded(true));
  }, [token]);

  useEffect(() => {
    // Waits for the user's existing tags before pre-filling — a draft's
    // tags only get pre-selected here when they match an existing
    // collection (reusing one isn't creating one); a genuinely new tag
    // Claude proposes is dropped rather than auto-applied or even offered
    // as a suggestion — collections are named by the user, not the AI
    // (decided 2026-09-14, see NOTES.md). A brand-new account with zero
    // tags still resolves this quickly since listTags() finishes either
    // way.
    if (isEditing || !existingTagsLoaded) return;

    const draft = route.params?.draft;
    const nextTitle = draft?.title ?? '';
    const nextServings = draft?.servings ? String(draft.servings) : '';
    const nextPrepTimeMin = draft?.prepTimeMin ? String(draft.prepTimeMin) : '';
    const nextCookTimeMin = draft?.cookTimeMin ? String(draft.cookTimeMin) : '';
    const nextSteps = draft && draft.steps.length > 0 ? draft.steps : [''];
    const nextIngredients =
      draft && draft.ingredients.length > 0 ? groupBySection(draft.ingredients) : [{ name: '', quantity: '', section: null }];
    const draftTags = draft?.tags ?? [];
    const matchedTags = draftTags.filter((tag) => existingTags.some((e) => e.name.toLowerCase() === tag.toLowerCase()));
    const nextTagsText = matchedTags.join(', ');
    const nextSource = route.params?.source ?? '';

    if (draft) {
      setTitle(nextTitle);
      setServings(nextServings);
      setPrepTimeMin(nextPrepTimeMin);
      setCookTimeMin(nextCookTimeMin);
      setSteps(nextSteps);
      setIngredients(nextIngredients);
      setTagsText(nextTagsText);
    }
    setSource(nextSource);
    if (route.params?.photo) setNewPhoto(route.params.photo);
    if (route.params?.photoCandidates && route.params.photoCandidates.length > 0) {
      setPhotoCandidates(route.params.photoCandidates);
      setSelectedCandidate(0);
    }

    initialSnapshotRef.current = buildFormSnapshot({
      title: nextTitle,
      servings: nextServings,
      prepTimeMin: nextPrepTimeMin,
      cookTimeMin: nextCookTimeMin,
      steps: nextSteps,
      ingredients: nextIngredients,
      tagsText: nextTagsText,
      source: nextSource,
    });
  }, [isEditing, existingTagsLoaded, existingTags, route.params?.draft, route.params?.source, route.params?.photo, route.params?.photoCandidates]);

  const selectedTags = useMemo(
    () => tagsText.split(',').map((t) => t.trim()).filter(Boolean),
    [tagsText],
  );

  const tagOptions = useMemo(() => {
    const existingNames = existingTags.map((t) => t.name);
    const newTags = selectedTags.filter(
      (t) => !existingNames.some((e) => e.toLowerCase() === t.toLowerCase()),
    );
    return [...existingNames, ...newTags];
  }, [existingTags, selectedTags]);

  function toggleTag(tag: string) {
    const isSelected = selectedTags.some((t) => t.toLowerCase() === tag.toLowerCase());
    const next = isSelected
      ? selectedTags.filter((t) => t.toLowerCase() !== tag.toLowerCase())
      : [...selectedTags, tag];
    setTagsText(next.join(', '));
  }

  // A name typed by the user — the only way a new collection gets created
  // here (it's saved by the recipe's find-or-create upsert). Commas would
  // split it, since tagsText is comma-separated.
  function addNewTag() {
    const name = capitalizeFirst(newTagName.replace(/,/g, ' ').trim());
    if (name && !selectedTags.some((t) => t.toLowerCase() === name.toLowerCase())) {
      const existing = existingTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
      setTagsText([...selectedTags, existing ? existing.name : name].join(', '));
    }
    setNewTagName('');
    setAddingTag(false);
  }

  useEffect(() => {
    if (!isEditing || !token || !recipeId) return;
    getRecipe(token, recipeId)
      .then((recipe) => {
        const nextTitle = recipe.title;
        const nextServings = recipe.servings ? String(recipe.servings) : '';
        const nextPrepTimeMin = recipe.prepTimeMin ? String(recipe.prepTimeMin) : '';
        const nextCookTimeMin = recipe.cookTimeMin ? String(recipe.cookTimeMin) : '';
        const nextSteps = recipe.steps.length > 0 ? recipe.steps : [''];
        // Grouped by section on load (not just at render) so the flat list —
        // and therefore the order saved back as `position` — has each
        // section's items together; the unsaved-changes snapshot below uses
        // this same grouped list, so loading alone doesn't count as a change.
        const nextIngredients =
          recipe.ingredients.length > 0 ? groupBySection(recipe.ingredients) : [{ name: '', quantity: '', section: null }];
        const nextTagsText = recipe.tags.join(', ');
        const nextSource = recipe.source ?? '';

        setTitle(nextTitle);
        setServings(nextServings);
        setPrepTimeMin(nextPrepTimeMin);
        setCookTimeMin(nextCookTimeMin);
        setSteps(nextSteps);
        setIngredients(nextIngredients);
        setTagsText(nextTagsText);
        setSource(nextSource);
        setExistingPhotoUrl(recipe.photoUrl);

        initialSnapshotRef.current = buildFormSnapshot({
          title: nextTitle,
          servings: nextServings,
          prepTimeMin: nextPrepTimeMin,
          cookTimeMin: nextCookTimeMin,
          steps: nextSteps,
          ingredients: nextIngredients,
          tagsText: nextTagsText,
          source: nextSource,
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Impossible de charger la recette'))
      .finally(() => setLoading(false));
  }, [isEditing, token, recipeId]);

  function applyPickedAsset(asset: ImagePicker.ImagePickerAsset) {
    setNewPhoto({
      uri: asset.uri,
      name: asset.fileName ?? `photo-${Date.now()}.jpg`,
      type: asset.mimeType ?? 'image/jpeg',
    });
    setRemovePhoto(false);
    setSelectedCandidate(null);
  }

  function selectPhotoCandidate(candidate: ScrapedPhotoCandidate, index: number) {
    setNewPhoto(saveBase64PhotoToFile(candidate.photoBase64, candidate.photoMimeType));
    setRemovePhoto(false);
    setSelectedCandidate(index);
  }

  async function handlePickFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Autorisation nécessaire', "Autorise l'accès à la photothèque pour ajouter une photo de recette.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (result.canceled || result.assets.length === 0) return;
    applyPickedAsset(result.assets[0]);
  }

  async function handleTakePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Autorisation nécessaire', "Autorise l'accès à la caméra pour prendre une photo de recette.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
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

  function handleClearPhoto() {
    setNewPhoto(null);
    // Only a saved photo needs deleting server-side; a just-picked one is
    // simply dropped.
    setRemovePhoto(Boolean(existingPhotoUrl));
    setSelectedCandidate(null);
  }

  function updateStep(index: number, value: string) {
    setSteps((prev) => prev.map((s, i) => (i === index ? value : s)));
  }
  function addStep() {
    setSteps((prev) => [...prev, '']);
  }
  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function updateIngredient(index: number, patch: Partial<RecipeIngredient>) {
    setIngredients((prev) => prev.map((ing, i) => (i === index ? { ...ing, ...patch } : ing)));
  }
  function addIngredient() {
    // Keeps plain (no-section) ingredients grouped together at the front,
    // even if sections were added after them.
    setIngredients((prev) => {
      let insertAt = 0;
      while (insertAt < prev.length && prev[insertAt].section === null) insertAt++;
      const next = [...prev];
      next.splice(insertAt, 0, { name: '', quantity: '', section: null });
      return next;
    });
  }
  function removeIngredient(index: number) {
    setIngredients((prev) => prev.filter((_, i) => i !== index));
  }

  // A recipe can have distinct parts (e.g. "Pour la pâte" / "Pour la
  // crème") — the same ingredient may then legitimately appear more than
  // once with a different quantity per part (see NOTES.md, 2026-09-11).
  // `ingredients` stays a flat array (matches the save payload and the
  // unsaved-changes snapshot); grouping consecutive same-section items is
  // purely a rendering concern.
  const ingredientGroups = useMemo(() => {
    const groups: { section: string | null; indices: number[] }[] = [];
    ingredients.forEach((item, index) => {
      const last = groups[groups.length - 1];
      if (last && last.section === item.section) {
        last.indices.push(index);
      } else {
        groups.push({ section: item.section, indices: [index] });
      }
    });
    return groups;
  }, [ingredients]);

  function addIngredientAfter(index: number, section: string | null) {
    setIngredients((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, { name: '', quantity: '', section });
      return next;
    });
  }
  function addSection() {
    setIngredients((prev) => [...prev, { name: '', quantity: '', section: 'Nouvelle section' }]);
  }
  function renameSection(indices: number[], nextSection: string) {
    setIngredients((prev) => prev.map((ing, i) => (indices.includes(i) ? { ...ing, section: nextSection } : ing)));
  }

  async function handleSave() {
    if (!token) return;
    setError(null);

    const trimmedTitle = capitalizeFirst(title.trim());
    const cleanSteps = steps.map((s) => capitalizeFirst(s.trim())).filter(Boolean);
    const cleanIngredients = ingredients
      .map((ing) => ({
        name: capitalizeFirst(ing.name.trim()),
        quantity: ing.quantity?.trim() || null,
        section: ing.section?.trim() ? capitalizeFirst(ing.section.trim()) : null,
      }))
      .filter((ing) => ing.name.length > 0);
    const cleanTags = tagsText
      .split(',')
      .map((t) => capitalizeFirst(t.trim()))
      .filter(Boolean);

    if (!trimmedTitle) {
      setError('Le titre est obligatoire');
      return;
    }
    if (cleanIngredients.length === 0) {
      setError('Au moins un ingrédient est requis');
      return;
    }
    if (cleanSteps.length === 0) {
      setError('Au moins une étape est requise');
      return;
    }
    if (cleanTags.length === 0) {
      setError('Choisis ou crée au moins une collection');
      return;
    }

    setSaving(true);
    try {
      const input = {
        title: trimmedTitle,
        prepTimeMin: prepTimeMin ? Number(prepTimeMin) : undefined,
        cookTimeMin: cookTimeMin ? Number(cookTimeMin) : undefined,
        servings: servings ? Number(servings) : undefined,
        source: source.trim() || undefined,
        steps: cleanSteps,
        ingredients: cleanIngredients,
        tags: cleanTags,
        photo: newPhoto ?? undefined,
        removePhoto,
      };

      if (isEditing && recipeId) {
        await updateRecipe(token, recipeId, input);
        setSaved({ createdId: null });
      } else {
        const created = await createRecipe(token, input);
        console.log(`[RecipeEdit] created recipe ${created.id} (fromAi=${fromAi})`);
        setSaved({ createdId: created.id });
      }
      // Setting state (rather than navigating directly) lets
      // usePreventRemove's guard re-render with preventRemove=false
      // *before* the navigation-triggered removal fires — see the effect
      // below. Doing both in the same tick would still see the old,
      // dirty-guarded value and re-show the alert.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'enregistrer la recette");
    } finally {
      setSaving(false);
    }
  }

  // A draft that hasn't been saved yet (structured by the AI, or prefilled
  // from a collection) is unsaved work in itself, even untouched: leaving
  // would throw away the import (2026-10-06).
  const isUnsavedDraft = !isEditing && Boolean(route.params?.draft);

  const isDirty =
    isUnsavedDraft ||
    newPhoto !== null ||
    removePhoto ||
    (initialSnapshotRef.current !== null &&
      buildFormSnapshot({ title, servings, prepTimeMin, cookTimeMin, steps, ingredients, tagsText, source }) !==
        initialSnapshotRef.current);

  useEffect(() => {
    if (!saved) return;
    // A new recipe (manual or imported) opens on its detail screen, with
    // only the home screen under it: back from there shouldn't land on an
    // import screen (Import → PhotoImport via screenshots stacks them,
    // 2026-10-06). Reusing the existing RecipeList route (same key) keeps it
    // mounted, so an open collection or tab is still there. An edit returns
    // to where it came from.
    if (saved.createdId) {
      const home = navigation.getState().routes.find((r) => r.name === 'RecipeList');
      console.log(`[RecipeEdit] created ${saved.createdId} — resetting stack to home › detail`);
      navigation.reset({
        index: 1,
        routes: [
          { name: 'RecipeList', key: home?.key },
          { name: 'RecipeDetail', params: { recipeId: saved.createdId } },
        ],
      });
    } else navigation.goBack();
  }, [saved, navigation]);

  // React Navigation's own recommended hook for this exact scenario — our
  // previous hand-rolled version (a `beforeRemove` listener + manually
  // toggling `gestureEnabled`) was "not fully supported in native-stack"
  // per its own warning: it missed the iOS long-press back-button menu
  // (which can pop multiple screens at once) and had a timing gap for
  // screens that arrive already dirty (e.g. from Import) since it only
  // disabled the gesture in a useEffect, which runs after the screen is
  // already interactive. usePreventRemove wires into native-stack's
  // `preventNativeDismiss` (a real native-level block) and disables the
  // back-button menu automatically, closing both gaps. Recurred 2026-09-11.
  usePreventRemove(isDirty && !saved, ({ data }) => {
    console.log(`[RecipeEdit] usePreventRemove intercepted (${fromAi ? 'AI draft' : 'edits'}) — showing unsaved-changes alert`);
    Alert.alert(
      fromAi ? 'Quitter sans enregistrer ?' : 'Modifications non enregistrées',
      fromAi
        ? "La recette mise en forme par l'IA sera perdue."
        : 'Tu veux enregistrer tes modifications avant de quitter ?',
      [
        {
          text: 'Quitter sans enregistrer',
          style: 'destructive',
          onPress: () => navigation.dispatch(data.action),
        },
        { text: 'Enregistrer', onPress: handleSave },
        { text: fromAi ? 'Continuer la relecture' : 'Annuler', style: 'cancel' },
      ],
    );
  });

  const screenTitle = isEditing ? 'Modifier la recette' : fromAi ? 'Relecture' : 'Nouvelle recette';

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const showExistingPhoto = Boolean(existingPhotoUrl && !removePhoto && !newPhoto);
  const hasPhoto = Boolean(newPhoto) || showExistingPhoto;
  const candidates = photoCandidates ?? [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <RoundButton icon="x" label="Fermer" onPress={() => navigation.goBack()} />
        <Text style={styles.topBarTitle}>{screenTitle}</Text>
        <View style={styles.topBarSpacer} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {fromAi && !isEditing && (
            <InfoNote icon={<Ionicons name="sparkles-outline" size={18} color={colors.terracotta} />}>
              <Text style={styles.strong}>Recette mise en forme par l'IA.</Text> Vérifie les quantités et choisis une
              collection avant d'enregistrer.
            </InfoNote>
          )}

          {/* Photo */}
          <View style={styles.block}>
            <FieldLabel>Photo</FieldLabel>
            {hasPhoto ? (
              <Image
                source={
                  newPhoto
                    ? { uri: newPhoto.uri }
                    : { uri: resolveUrl(existingPhotoUrl!), headers: { Authorization: `Bearer ${token}` } }
                }
                style={styles.photo}
              />
            ) : (
              <DashedTile icon="camera" label="Ajouter une photo du plat" onPress={handleAddPhoto} style={styles.photoTile} />
            )}

            {candidates.length > 0 ? (
              <View style={styles.thumbRow}>
                {candidates.map((candidate, index) => (
                  <Pressable
                    key={candidate.label}
                    onPress={() => selectPhotoCandidate(candidate, index)}
                    style={[styles.thumbRing, selectedCandidate === index && styles.thumbRingSelected]}
                    accessibilityLabel={`Image ${index + 1} du post`}
                  >
                    <Image
                      source={{ uri: `data:${candidate.photoMimeType};base64,${candidate.photoBase64}` }}
                      style={styles.thumb}
                    />
                  </Pressable>
                ))}
                <Pressable
                  onPress={handleAddPhoto}
                  style={[styles.thumbRing, selectedCandidate === null && hasPhoto && styles.thumbRingSelected]}
                  accessibilityLabel="Choisir une autre photo"
                >
                  <View style={[styles.thumb, styles.thumbAdd]}>
                    <Feather name="plus" size={20} color={colors.ink} />
                  </View>
                </Pressable>
                <Text style={styles.thumbCaption}>{candidates.length} images{'\n'}dans ce post</Text>
              </View>
            ) : (
              <View style={styles.photoLinks}>
                {hasPhoto && (
                  <>
                    <Pressable onPress={handleAddPhoto} hitSlop={6}>
                      <Text style={styles.actionLink}>Changer la photo</Text>
                    </Pressable>
                    <Pressable onPress={handleClearPhoto} hitSlop={6}>
                      <Text style={styles.mutedLink}>Retirer</Text>
                    </Pressable>
                  </>
                )}
                {!hasPhoto && removePhoto && existingPhotoUrl && (
                  // Just cleared a recipe's saved photo — one tap brings it
                  // back (Clémentine, 2026-09-15, see NOTES.md).
                  <Pressable onPress={() => setRemovePhoto(false)} hitSlop={6}>
                    <Text style={styles.actionLink}>Remettre la photo d'origine</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>

          {/* Titre */}
          <View style={styles.block}>
            <FieldLabel>Titre</FieldLabel>
            <TextInput
              style={styles.titleInput}
              value={title}
              onChangeText={setTitle}
              placeholder="Titre de la recette"
              placeholderTextColor={colors.navInactive}
              multiline
              scrollEnabled={false}
              submitBehavior="blurAndSubmit"
              returnKeyType="done"
            />
          </View>

          {/* Collections */}
          <View style={styles.block}>
            <FieldLabel right={<Text style={styles.requiredHint}>Au moins une</Text>}>Collections</FieldLabel>
            <View style={styles.chips}>
              {tagOptions.map((tag) => {
                const isSelected = selectedTags.some((t) => t.toLowerCase() === tag.toLowerCase());
                return (
                  <Pressable
                    key={tag}
                    onPress={() => toggleTag(tag)}
                    style={[styles.chip, isSelected && styles.chipSelected]}
                  >
                    {isSelected && <Feather name="check" size={14} color={colors.white} />}
                    <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{tag}</Text>
                  </Pressable>
                );
              })}
              {!addingTag && (
                <Pressable style={[styles.chip, styles.chipNew]} onPress={() => setAddingTag(true)}>
                  <Text style={styles.chipText}>+ Nouvelle</Text>
                </Pressable>
              )}
            </View>
            {addingTag && (
              <View style={styles.newTagRow}>
                <TextInput
                  style={styles.newTagInput}
                  value={newTagName}
                  onChangeText={setNewTagName}
                  placeholder="Nom de la collection"
                  placeholderTextColor={colors.navInactive}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={addNewTag}
                />
                <Pressable onPress={addNewTag} hitSlop={8} accessibilityLabel="Ajouter la collection">
                  <Feather name="check" size={20} color={colors.ink} />
                </Pressable>
                <Pressable
                  onPress={() => {
                    setAddingTag(false);
                    setNewTagName('');
                  }}
                  hitSlop={8}
                  accessibilityLabel="Annuler"
                >
                  <Feather name="x" size={20} color={colors.text2} />
                </Pressable>
              </View>
            )}
          </View>

          {/* Temps */}
          <View style={[styles.block, styles.timesRow]}>
            {(
              [
                ['Prépa', prepTimeMin, setPrepTimeMin, 'min'],
                ['Cuisson', cookTimeMin, setCookTimeMin, 'min'],
                ['Parts', servings, setServings, null],
              ] as const
            ).map(([label, value, setter, unit]) => (
              <View key={label} style={styles.timeCol}>
                <FieldLabel>{label}</FieldLabel>
                <View style={styles.timeField}>
                  <TextInput
                    style={styles.timeInput}
                    value={value}
                    onChangeText={setter}
                    keyboardType="number-pad"
                    placeholder="–"
                    placeholderTextColor={colors.navInactive}
                  />
                  {unit && <Text style={styles.timeUnit}>{unit}</Text>}
                </View>
              </View>
            ))}
          </View>

          {/* Ingrédients */}
          <Text style={styles.sectionTitle}>Ingrédients</Text>
          <View style={styles.rows}>
            {ingredientGroups.map((group, gi) => (
              <View key={gi}>
                {group.section !== null && (
                  <TextInput
                    style={styles.sectionHeaderInput}
                    placeholder="Nom de la section (ex. Pour la pâte)"
                    placeholderTextColor={colors.navInactive}
                    value={group.section}
                    onChangeText={(v) => renameSection(group.indices, v)}
                  />
                )}
                {group.indices.map((index) => {
                  const ing = ingredients[index];
                  return (
                    <View key={index} style={styles.ingredientRow}>
                      <TextInput
                        style={styles.qtyInput}
                        placeholder="Qté"
                        placeholderTextColor={colors.navInactive}
                        value={ing.quantity ?? ''}
                        onChangeText={(v) => updateIngredient(index, { quantity: v })}
                      />
                      <TextInput
                        style={styles.nameInput}
                        placeholder="Ingrédient"
                        placeholderTextColor={colors.navInactive}
                        value={ing.name}
                        onChangeText={(v) => updateIngredient(index, { name: v })}
                      />
                      <Pressable
                        onPress={() => removeIngredient(index)}
                        style={styles.removeButton}
                        accessibilityLabel="Retirer l'ingrédient"
                      >
                        <Feather name="x" size={17} color={colors.navInactive} />
                      </Pressable>
                    </View>
                  );
                })}
                {group.section !== null && (
                  <Pressable
                    style={styles.addLink}
                    onPress={() => addIngredientAfter(group.indices[group.indices.length - 1], group.section)}
                  >
                    <Text style={styles.addLinkText}>+ Ajouter à cette section</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
          <Pressable style={styles.addLink} onPress={addIngredient}>
            <Text style={styles.addLinkText}>+ Ajouter un ingrédient</Text>
          </Pressable>
          <Pressable style={styles.addLinkTight} onPress={addSection}>
            <Text style={styles.addLinkMuted}>+ Ajouter une section (ex. Pour la pâte)</Text>
          </Pressable>

          {/* Préparation */}
          <Text style={styles.sectionTitle}>Préparation</Text>
          {steps.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <Text style={styles.stepNumber}>{i + 1}</Text>
              <TextInput
                style={styles.stepInput}
                placeholder={`Étape ${i + 1}`}
                placeholderTextColor={colors.navInactive}
                value={step}
                onChangeText={(v) => updateStep(i, v)}
                multiline
                scrollEnabled={false}
              />
              <Pressable onPress={() => removeStep(i)} style={styles.stepRemove} accessibilityLabel="Retirer l'étape">
                <Feather name="x" size={16} color={colors.navInactive} />
              </Pressable>
            </View>
          ))}
          <Pressable style={styles.addLink} onPress={addStep}>
            <Text style={styles.addLinkText}>+ Ajouter une étape</Text>
          </Pressable>

          {/* Source */}
          <View style={styles.sourceBlock}>
            <FieldLabel>Source (facultatif)</FieldLabel>
            <View style={styles.sourceField}>
              <Feather name={/instagram\.com/i.test(source) ? 'instagram' : 'link'} size={16} color={colors.text2} />
              <TextInput
                style={styles.sourceInput}
                value={source}
                onChangeText={setSource}
                placeholder="Lien, livre, nom d'une personne…"
                placeholderTextColor={colors.navInactive}
                autoCapitalize="none"
              />
            </View>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <BottomActionBar label="Enregistrer la recette" arrow={false} onPress={handleSave} loading={saving} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const ROW_MIN = 50;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SIDE,
    paddingTop: 6,
    paddingBottom: 10,
  },
  topBarTitle: { fontFamily: fonts.sansSemiBold, fontSize: 16, color: colors.ink },
  topBarSpacer: { width: 44 },
  content: { paddingHorizontal: SIDE, paddingTop: 6, paddingBottom: 32 },
  strong: { fontFamily: fonts.sansSemiBold },
  block: { marginTop: 26 },
  photo: { width: '100%', height: 210, borderRadius: radii.photo, backgroundColor: colors.surface, marginTop: 10 },
  photoTile: { marginTop: 10 },
  thumbRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  // The ring sits around the thumbnail: 2px terracotta when selected.
  thumbRing: { borderRadius: radii.photo + 3, borderWidth: 2, borderColor: 'transparent', padding: 2 },
  thumbRingSelected: { borderColor: colors.terracotta },
  thumb: { width: 60, height: 60, borderRadius: radii.sm, backgroundColor: colors.surface },
  thumbAdd: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.dashed,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbCaption: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 18, color: colors.text2, marginLeft: 6 },
  photoLinks: { flexDirection: 'row', gap: 20, marginTop: 10 },
  actionLink: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.terracottaText },
  mutedLink: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.text2 },
  titleInput: {
    fontFamily: fonts.serifSemiBold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    paddingTop: 8,
    paddingBottom: 12,
  },
  requiredHint: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.terracottaText },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: {
    height: 36,
    borderRadius: 18,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.white,
  },
  chipSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipNew: { borderStyle: 'dashed', borderColor: colors.dashed },
  chipText: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.ink },
  chipTextSelected: { color: colors.white, fontFamily: fonts.sansSemiBold },
  newTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 12,
    borderBottomWidth: 2,
    borderBottomColor: colors.ink,
  },
  newTagInput: { flex: 1, fontFamily: fonts.sans, fontSize: 16, color: colors.ink, paddingVertical: 10 },
  timesRow: { flexDirection: 'row', gap: 20 },
  timeCol: { flex: 1 },
  timeField: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    marginTop: 6,
  },
  timeInput: {
    flex: 1,
    fontFamily: fonts.serifSemiBold,
    fontSize: 22,
    color: colors.ink,
    paddingVertical: 8,
  },
  timeUnit: { fontFamily: fonts.sans, fontSize: 13, color: colors.text2 },
  sectionTitle: {
    fontFamily: fonts.serifSemiBold,
    fontSize: 26,
    letterSpacing: -0.5,
    color: colors.ink,
    marginTop: 36,
    marginBottom: 10,
  },
  rows: { borderTopWidth: 1, borderTopColor: colors.hairline },
  sectionHeaderInput: {
    fontFamily: fonts.serifSemiBold,
    fontSize: 18,
    color: colors.ink,
    paddingTop: 18,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: ROW_MIN,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  qtyInput: {
    width: 84,
    fontFamily: fonts.sansSemiBold,
    fontSize: 15,
    color: colors.ink,
    paddingVertical: 12,
    paddingRight: 8,
  },
  nameInput: { flex: 1, fontFamily: fonts.sans, fontSize: 15, color: colors.ink, paddingVertical: 12 },
  removeButton: { width: 36, height: ROW_MIN, alignItems: 'flex-end', justifyContent: 'center' },
  addLink: { marginTop: 16, alignSelf: 'flex-start' },
  addLinkTight: { marginTop: 12, alignSelf: 'flex-start' },
  addLinkText: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.terracottaText },
  addLinkMuted: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.text2 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 10 },
  stepNumber: {
    width: 44,
    fontFamily: fonts.serifSemiBold,
    fontSize: 28,
    lineHeight: 34,
    color: colors.terracotta,
  },
  stepInput: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
    paddingTop: 5,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  stepRemove: { width: 30, paddingTop: 9, alignItems: 'flex-end' },
  sourceBlock: { marginTop: 36 },
  sourceField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    marginTop: 6,
  },
  sourceInput: { flex: 1, fontFamily: fonts.sans, fontSize: 14, color: colors.text2, paddingVertical: 10 },
  error: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.danger, marginTop: 20 },
});
