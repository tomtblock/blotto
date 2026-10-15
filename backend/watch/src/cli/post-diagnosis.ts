/*
 * diagnose.yml, last step: post Claude's diagnosis as a SILENT reply in the
 * alert's thread — or, when there is none, say the diagnosis is unavailable
 * so the thread is never left promising one. Usage:
 *
 *   ts-node src/cli/post-diagnosis.ts --execution-file=<file> --reply-to=<message id> [--run-url=<url>] [--reason=<text>]
 *   ts-node src/cli/post-diagnosis.ts --result=<file> …   (a bare answer, for a manual re-post)
 *
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID. Prints nothing of the
 * diagnosis itself: the repository is public, and so is this run's log.
 */

import * as fs from 'fs';
import { extractStructuredOutput, parseDiagnosis, renderDiagnosis, renderDiagnosisUnavailable } from '../diagnosis';
import { TelegramNotifier } from '../telegram';

const arg = (name: string): string | null => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};

async function run(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required');
  const replyTo = Number(arg('reply-to'));
  if (!Number.isInteger(replyTo) || replyTo <= 0) throw new Error('--reply-to must be a message id');
  const read = (name: string): string => {
    const file = arg(name);
    return file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
  };
  const execution = read('execution-file');
  const raw = execution ? (extractStructuredOutput(execution) ?? '') : read('result');
  const d = raw ? parseDiagnosis(raw) : null;
  const html = d
    ? renderDiagnosis(d)
    : renderDiagnosisUnavailable(arg('reason') ?? (raw ? 'its answer was not in the expected shape' : 'it produced no answer'), arg('run-url'));
  const id = await new TelegramNotifier(token, chat).send(html, { replyTo, silent: true });
  if (id === null) throw new Error('Telegram did not accept the reply');
  console.log(d ? 'diagnosis posted' : 'posted: diagnosis unavailable');
}

run().catch((e) => {
  console.error(`post-diagnosis: ${(e as Error).message}`);
  process.exit(1);
});
