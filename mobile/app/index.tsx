import { FlatList, View, Text, StyleSheet } from 'react-native';
import { useStore } from '../store';

export default function NewsScreen() {
  const news = useStore(s => s.news);

  return (
    <FlatList
      data={news}
      keyExtractor={item => item.id}
      style={styles.list}
      renderItem={({ item }) => (
        <View style={styles.item}>
          <View style={styles.meta}>
            <Text style={styles.source}>{item.source}</Text>
            <Text style={styles.time}>
              {new Date(item.time).toLocaleTimeString()}
            </Text>
          </View>
          <Text style={styles.title}>{item.title}</Text>
          {item.symbols && item.symbols.length > 0 && (
            <View style={styles.symbols}>
              {item.symbols.map(s => (
                <View key={s} style={styles.tag}>
                  <Text style={styles.tagText}>{s}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
      ListEmptyComponent={
        <Text style={styles.empty}>Waiting for news...</Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: '#0d0d0f' },
  item: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a30',
    backgroundColor: '#141417',
  },
  meta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  source: { fontSize: 10, fontWeight: '700', color: '#3b82f6', textTransform: 'uppercase' },
  time: { fontSize: 10, color: '#6b6b78', fontVariant: ['tabular-nums'] },
  title: { fontSize: 14, color: '#e8e8ea', lineHeight: 20 },
  symbols: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  tag: { backgroundColor: '#1c1c21', borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2 },
  tagText: { fontSize: 10, color: '#6b6b78' },
  empty: { padding: 24, textAlign: 'center', color: '#6b6b78' },
});
