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
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../context/AuthContext';
import { scrapeInstagramUrl, structureRecipe } from '../lib/api';
import { colors, radii, fonts } from '../lib/theme';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Import'>;

type Photo = { uri: string; base64: string; mimeType: string };

export default function ImportScreen() {
  const navigation = useNavigation<Nav>();
  const { token } = useAuth();

  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchNotice, setFetchNotice] = useState<string | null>(null);

  const [caption, setCaption] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);

  const [structuring, setStructuring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFetch() {
    if (!token || !url.trim()) return;
    setError(null);
    setFetchNotice(null);
    setFetching(true);
    try {
      const result = await scrapeInstagramUrl(token, url.trim());
      if (result.caption) setCaption(result.caption);
      if (result.photoBase64 && result.photoMimeType) {
        setPhoto({
          uri: `data:${result.photoMimeType};base64,${result.photoBase64}`,
          base64: result.photoBase64,
          mimeType: result.photoMimeType,
        });
      }
      if (!result.scraped) {
        setFetchNotice('Récupération automatique impossible — remplis la légende et/ou ajoute une photo ci-dessous.');
      }
    } catch (err) {
      setFetchNotice('Récupération automatique impossible — remplis la légende et/ou ajoute une photo ci-dessous.');
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
    Alert.alert('Ajouter une photo', undefined, [
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
      navigation.replace('RecipeEdit', { draft, source: url.trim() || undefined });
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
            {fetching ? <ActivityIndicator color={colors.white} /> : <Text style={styles.fetchButtonText}>Récupérer</Text>}
          </Pressable>
        </View>
        {fetchNotice ? <Text style={styles.notice}>{fetchNotice}</Text> : null}

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

        <Pressable style={styles.linkButton} onPress={() => navigation.replace('RecipeEdit', {})}>
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
  notice: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.gray, marginTop: 6 },
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
