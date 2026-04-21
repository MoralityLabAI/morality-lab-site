import { sql } from '@vercel/postgres';
import { hasPostgresConfig, methodNotAllowed, sendJson } from '../_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  try {
    if (!hasPostgresConfig()) {
      return sendJson(res, 503, {
        error: 'Storyworld database is not connected yet',
        stats: {
          total_storyworlds: 0,
          total_views: 0,
          total_likes: 0,
          total_forks: 0,
        },
        trending: [],
        recent: [],
        popular: [],
      });
    }

    const statsResult = await sql`
      SELECT
        COUNT(*) AS total_storyworlds,
        COALESCE(SUM(views), 0) AS total_views,
        COALESCE(SUM(likes), 0) AS total_likes,
        COALESCE(SUM(fork_count), 0) AS total_forks
      FROM storyworlds
      WHERE is_public = true
    `;

    const trendingResult = await sql`
      SELECT
        id,
        title,
        description,
        num_characters,
        num_themes,
        num_variables,
        encounter_length,
        views,
        likes,
        fork_count,
        created_at
      FROM storyworlds
      WHERE is_public = true
        AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY likes DESC, views DESC
      LIMIT 10
    `;

    const recentResult = await sql`
      SELECT
        id,
        title,
        description,
        num_characters,
        num_themes,
        num_variables,
        encounter_length,
        views,
        likes,
        fork_count,
        created_at
      FROM storyworlds
      WHERE is_public = true
      ORDER BY created_at DESC
      LIMIT 10
    `;

    const popularResult = await sql`
      SELECT
        id,
        title,
        description,
        num_characters,
        num_themes,
        num_variables,
        encounter_length,
        views,
        likes,
        fork_count,
        created_at
      FROM storyworlds
      WHERE is_public = true
      ORDER BY views DESC
      LIMIT 10
    `;

    return sendJson(res, 200, {
      stats: statsResult.rows[0],
      trending: trendingResult.rows,
      recent: recentResult.rows,
      popular: popularResult.rows,
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'Failed to fetch stats',
      details: error.message,
    });
  }
}
