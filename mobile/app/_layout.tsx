import { Tabs } from 'expo-router';
import { useBackend } from '../hooks/useBackend';
import { usePushNotifications } from '../hooks/usePushNotifications';

export default function Layout() {
  useBackend();
  usePushNotifications();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: '#141417' },
        headerTintColor: '#e8e8ea',
        tabBarStyle: { backgroundColor: '#141417', borderTopColor: '#2a2a30' },
        tabBarActiveTintColor: '#3b82f6',
        tabBarInactiveTintColor: '#6b6b78',
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'News' }} />
      <Tabs.Screen name="watchlist" options={{ title: 'Watchlist' }} />
      <Tabs.Screen name="positions" options={{ title: 'Positions' }} />
    </Tabs>
  );
}
