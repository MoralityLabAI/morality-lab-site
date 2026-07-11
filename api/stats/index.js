import liveHandler from '../../storyworld-app/api/stats/index.js';
import { hasPostgresConfig, methodNotAllowed, sendJson } from '../../storyworld-app/api/_lib.js';

export default async function handler(req, res) {
  if (hasPostgresConfig()) return liveHandler(req, res);
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  return sendJson(res, 200, {
    stats: { total_storyworlds: 1, total_views: 0, total_likes: 0, total_forks: 0 },
    source: 'local'
  });
}
