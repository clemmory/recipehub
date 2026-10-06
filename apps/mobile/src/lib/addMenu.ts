import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import type { AddChoice } from '../components/AddRecipeSheet';

// Where each choice of the "Ajouter une recette" sheet (AddRecipeSheet)
// leads — shared by RecipeListScreen and ProfileScreen. `presetTag` = the
// open collection, preselected on whatever recipe comes out. 'existing' is
// handled by RecipeListScreen itself (it opens its recipe picker).
export function openAddChoice(
  navigation: Pick<NativeStackNavigationProp<RootStackParamList>, 'navigate'>,
  choice: Exclude<AddChoice, 'existing'>,
  presetTag?: string,
) {
  if (choice === 'instagram') {
    navigation.navigate('Import', presetTag ? { presetTag } : undefined);
  } else if (choice === 'photos') {
    navigation.navigate('PhotoImport', presetTag ? { presetTag } : undefined);
  } else {
    navigation.navigate(
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
    );
  }
}
