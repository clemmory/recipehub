import { View, Text, StyleSheet } from 'react-native';

export default function RecipeDetailScreen() {
  return (
    <View style={styles.container}>
      <Text>Recipe Detail — Phase 1</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
