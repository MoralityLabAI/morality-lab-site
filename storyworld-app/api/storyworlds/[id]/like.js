import { sql } from '@vercel/postgres';
import { methodNotAllowed, sendJson } from '../../_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  try {
    const { id, action } = req.query;

    if (action === 'like') {
      await sql`
        UPDATE storyworlds
        SET likes = likes + 1
        WHERE id = ${id}
      `;
    } else if (action === 'unlike') {
      await sql`
        UPDATE storyworlds
        SET likes = GREATEST(likes - 1, 0)
        WHERE id = ${id}
      `;
    } else {
      return sendJson(res, 400, {
        error: 'Invalid action. Use ?action=like or ?action=unlike',
      });
    }

    const result = await sql`
      SELECT id, likes
      FROM storyworlds
      WHERE id = ${id}
      LIMIT 1
    `;

    if (result.rows.length === 0) {
      return sendJson(res, 404, { error: 'Storyworld not found' });
    }

    return sendJson(res, 200, {
      success: true,
      id: result.rows[0].id,
      likes: result.rows[0].likes,
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'Failed to toggle like',
      details: error.message,
    });
  }
}
