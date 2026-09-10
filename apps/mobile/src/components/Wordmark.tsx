import { Text, View, StyleSheet } from 'react-native';
import { colors, fonts } from '../lib/theme';

export default function Wordmark({
  tagline,
  size = 26,
  align = 'center',
}: {
  tagline?: string;
  size?: number;
  align?: 'center' | 'left';
}) {
  return (
    <View style={[styles.wrap, align === 'left' && styles.wrapLeft]}>
      <Text style={[styles.word, { fontSize: size }]}>
        Tambo
        <Text style={styles.dot}>.</Text>
      </Text>
      {tagline ? (
        <Text style={[styles.tagline, align === 'left' && styles.taglineLeft]}>{tagline}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  wrapLeft: { alignItems: 'flex-start' },
  word: { fontFamily: fonts.serifBold, color: colors.charcoal, letterSpacing: -0.3 },
  dot: { color: colors.terracotta },
  tagline: {
    fontFamily: fonts.sansMedium,
    fontSize: 11.5,
    color: colors.gray,
    marginTop: 2,
    textAlign: 'center',
  },
  taglineLeft: { textAlign: 'left' },
});
