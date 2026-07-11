import liveHandler from '../../storyworld-app/api/storyworlds/index.js';
import { hasPostgresConfig, methodNotAllowed, sendJson } from '../../storyworld-app/api/_lib.js';

const localWorlds = [{
  id: 'mihna',
  title: 'The Mihna',
  description: 'Baghdad, 833 CE. Navigate an inquisition where doctrine, conscience, and state power collide.',
  genre: 'Historical',
  theme: 'Constitutional alignment',
  size_category: 'Epic',
  localPath: '/storyworlds/mihna_constitutional_alignment.json',
  views: 0,
  likes: 0,
  encounter: {
    encounter: 'The court is waiting. The Caliph has made belief a condition of public office, and every answer now carries a cost.',
    choices: ['Enter the council chamber', 'Seek Ibn Hanbal first', 'Review the decree']
  }
}];

export default async function handler(req, res) {
  if (hasPostgresConfig()) return liveHandler(req, res);
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  return sendJson(res, 200, { storyworlds: localWorlds, total: localWorlds.length, source: 'local' });
}
