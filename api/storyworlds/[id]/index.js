import liveHandler from '../../../storyworld-app/api/storyworlds/[id]/index.js';
import { hasPostgresConfig, methodNotAllowed, sendJson } from '../../../storyworld-app/api/_lib.js';

const localWorld = {
  id: 'mihna',
  title: 'The Mihna',
  description: 'Baghdad, 833 CE. Navigate an inquisition where doctrine, conscience, and state power collide.',
  genre: 'Historical',
  theme: 'Constitutional alignment',
  localPath: '/storyworlds/mihna_constitutional_alignment.json',
  encounter: { encounter: 'The court is waiting.', choices: ['Enter the council chamber', 'Seek Ibn Hanbal first', 'Review the decree'] }
};

export default async function handler(req, res) {
  if (hasPostgresConfig()) return liveHandler(req, res);
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  if (req.query.id === 'mihna') return sendJson(res, 200, { storyworld: localWorld, source: 'local' });
  return sendJson(res, 404, { error: 'Storyworld not found' });
}
