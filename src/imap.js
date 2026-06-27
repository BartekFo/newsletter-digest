import { ImapFlow } from 'imapflow';

/**
 * Determine what to fetch based on the last-seen UID.
 *
 * @param {number|null} lastUid - last UID stored in the cursor; null means first run
 * @param {number} bootstrapDays - how many days back to go on first run
 * @param {Date} [now=new Date()] - injectable clock for deterministic tests
 * @returns {{ mode: 'since', since: Date } | { mode: 'uid', range: string }}
 */
export function buildFetchCriteria(lastUid, bootstrapDays, now = new Date()) {
  if (lastUid == null) {
    const since = new Date(now.getTime() - bootstrapDays * 24 * 3600 * 1000);
    return { mode: 'since', since };
  }
  return { mode: 'uid', range: `${lastUid + 1}:*` };
}

/**
 * Connect to Gmail via IMAP and fetch new messages from the configured folder.
 *
 * @param {{ gmailUser: string, gmailAppPassword: string, imapFolder: string, bootstrapDays: number }} config
 * @param {number|null} lastUid
 * @returns {Promise<{ raw: Buffer, uid: number }[]>}
 */
export async function fetchNewMessages(config, lastUid) {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: config.gmailUser,
      pass: config.gmailAppPassword,
    },
    // Suppress imapflow's built-in logger to keep output clean
    logger: false,
  });

  const messages = [];

  try {
    await client.connect();
    await client.mailboxOpen(config.imapFolder);

    const criteria = buildFetchCriteria(lastUid, config.bootstrapDays);

    if (criteria.mode === 'since') {
      // Search for messages since the bootstrap date, then fetch their sources
      const uids = await client.search({ since: criteria.since }, { uid: true });

      if (uids.length > 0) {
        const range = uids.join(',');
        for await (const message of client.fetch(range, { source: true }, { uid: true })) {
          messages.push({ raw: message.source, uid: message.uid });
        }
      }
    } else {
      // Incremental: fetch UID range (lastUid+1):*
      for await (const message of client.fetch(criteria.range, { source: true }, { uid: true })) {
        messages.push({ raw: message.source, uid: message.uid });
      }
    }
  } finally {
    await client.logout();
  }

  return messages;
}
