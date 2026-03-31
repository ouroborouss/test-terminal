import { FlatList, View, Text, StyleSheet } from 'react-native';
import { useStore } from '../store';

export default function PositionsScreen() {
  const positions = useStore(s => s.positions);

  return (
    <FlatList
      data={positions}
      keyExtractor={item => item.id.toString()}
      style={styles.list}
      renderItem={({ item }) => (
        <View style={styles.item}>
          <View style={styles.row}>
            <Text style={styles.symbol}>{item.symbol}</Text>
            <Text style={[styles.side, item.side === 'long' ? styles.long : styles.short]}>
              {item.side.toUpperCase()}
            </Text>
            <Text style={styles.exchange}>{item.exchange}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Size</Text>
            <Text style={styles.value}>{item.size}</Text>
            <Text style={styles.label}>Entry</Text>
            <Text style={styles.value}>${item.entry_price.toLocaleString()}</Text>
            {item.current_price != null && (
              <>
                <Text style={styles.label}>Now</Text>
                <Text style={styles.value}>${item.current_price.toLocaleString()}</Text>
              </>
            )}
          </View>
          {item.pnl != null && (
            <Text style={[styles.pnl, item.pnl >= 0 ? styles.positive : styles.negative]}>
              {item.pnl >= 0 ? '+' : ''}${item.pnl.toFixed(2)}
            </Text>
          )}
        </View>
      )}
      ListEmptyComponent={
        <Text style={styles.empty}>No open positions</Text>
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
    gap: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  symbol: { flex: 1, fontWeight: '700', fontSize: 15, color: '#e8e8ea' },
  side: { fontWeight: '700', fontSize: 12 },
  long: { color: '#22c55e' },
  short: { color: '#ef4444' },
  exchange: { fontSize: 11, color: '#6b6b78' },
  label: { fontSize: 11, color: '#6b6b78' },
  value: { fontSize: 12, color: '#e8e8ea', fontVariant: ['tabular-nums'] },
  pnl: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  positive: { color: '#22c55e' },
  negative: { color: '#ef4444' },
  empty: { padding: 24, textAlign: 'center', color: '#6b6b78' },
});
