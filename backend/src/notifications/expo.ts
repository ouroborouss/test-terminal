import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { getExpoTokens } from '../db';

const expo = new Expo();

export async function sendPushNotification(notification: {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}) {
  const tokens = getExpoTokens();
  if (tokens.length === 0) return;

  const messages: ExpoPushMessage[] = tokens
    .filter(token => Expo.isExpoPushToken(token))
    .map(token => ({
      to: token,
      sound: 'default',
      title: notification.title,
      body: notification.body,
      data: notification.data ?? {},
    }));

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
    } catch (err) {
      console.error('[Expo] Push error:', err);
    }
  }
}
