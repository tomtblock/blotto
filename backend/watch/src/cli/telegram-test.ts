/*
 * deploy-watch.yml, optional last step: one message to prove the bot can
 * reach the group. The only "all is well" message the watcher ever sends,
 * and only when someone asks for it.
 */

import { TelegramNotifier } from '../telegram';

async function run(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required');
  const id = await new TelegramNotifier(token, chat).send(
    '👋 <b>Blotto watcher connected.</b> From now on this group only hears from me when something breaks.'
  );
  if (id === null) throw new Error('Telegram did not accept the message — check the bot is in the group and the chat id');
  console.log('test message delivered');
}

run().catch((e) => {
  console.error(`telegram-test: ${(e as Error).message}`);
  process.exit(1);
});
