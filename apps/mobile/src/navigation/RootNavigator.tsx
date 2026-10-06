import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthProvider, useAuth } from '../context/AuthContext';
import AuthScreen from '../screens/AuthScreen';
import RecipeListScreen from '../screens/RecipeListScreen';
import RecipeDetailScreen from '../screens/RecipeDetailScreen';
import RecipeEditScreen from '../screens/RecipeEditScreen';
import ImportScreen from '../screens/ImportScreen';
import PhotoImportScreen from '../screens/PhotoImportScreen';
import ProfileScreen from '../screens/ProfileScreen';
import { colors, fonts } from '../lib/theme';
import type { StructuredRecipeDraft, ScrapedPhotoCandidate } from '../lib/api';

export type RootStackParamList = {
  Auth: undefined;
  RecipeList: undefined;
  RecipeDetail: { recipeId: string };
  RecipeEdit: {
    recipeId?: string;
    draft?: StructuredRecipeDraft;
    source?: string;
    // The draft comes from an AI import: the screen becomes « Relecture »,
    // with a note asking to check it.
    fromAi?: boolean;
    photo?: { uri: string; name: string; type: string };
    // A carousel's images to choose from, with `photo` preselected to the
    // first — shown as thumbnails under the photo.
    photoCandidates?: ScrapedPhotoCandidate[];
  };
  // Set when the user starts an import from an empty collection's "Ajouter
  // une recette" menu — forces this collection onto the imported recipe.
  Import: { presetTag?: string } | undefined;
  // Photo import (Phase 3) — same presetTag as Import. `source` is set when
  // coming from a failed Instagram import: the photos are then screenshots
  // of the post's caption, and the link is kept as the recipe's source.
  PhotoImport: { presetTag?: string; source?: string } | undefined;
  Profile: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function Navigator() {
  const { token, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.white },
          headerShadowVisible: false,
          headerTitleStyle: { color: colors.ink, fontFamily: fonts.serifBold, fontSize: 20 },
          headerTintColor: colors.terracotta,
          contentStyle: { backgroundColor: colors.white },
        }}
      >
        {token ? (
          <>
            <Stack.Screen name="RecipeList" component={RecipeListScreen} options={{ headerShown: false }} />
            <Stack.Screen
              name="RecipeDetail"
              component={RecipeDetailScreen}
              // Custom header: round buttons over the full-width photo or cover.
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="RecipeEdit"
              component={RecipeEditScreen}
              // Custom top bar (close + centered title), like the import screens.
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Import"
              component={ImportScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="PhotoImport"
              component={PhotoImportScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Profile"
              component={ProfileScreen}
              // Reached from the bottom nav, not pushed like a detail screen:
              // no back button or swipe-back, the bar is the way out.
              options={{ title: 'Profil', headerBackVisible: false, gestureEnabled: false, animation: 'none' }}
            />
          </>
        ) : (
          <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function RootNavigator() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Navigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
