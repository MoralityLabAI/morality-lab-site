import { sql } from '@vercel/postgres';
import { methodNotAllowed, readJsonBody, sendJson } from '../../_lib.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return getStoryworld(req, res);
  }

  if (req.method === 'PATCH') {
    return updateStoryworld(req, res);
  }

  if (req.method === 'DELETE') {
    return deleteStoryworld(req, res);
  }

  return methodNotAllowed(res, ['GET', 'PATCH', 'DELETE']);
}

async function getStoryworld(req, res) {
  try {
    const { id } = req.query;
    const result = await sql`
      SELECT *
      FROM storyworlds
      WHERE id = ${id}
      LIMIT 1
    `;

    if (result.rows.length === 0) {
      return sendJson(res, 404, { error: 'Storyworld not found' });
    }

    await sql`
      UPDATE storyworlds
      SET views = views + 1
      WHERE id = ${id}
    `;

    return sendJson(res, 200, { storyworld: result.rows[0] });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'Failed to fetch storyworld',
      details: error.message,
    });
  }
}

async function updateStoryworld(req, res) {
  try {
    const { id } = req.query;
    const body = await readJsonBody(req);
    const updates = [];
    const values = [];

    if (body.title !== undefined) {
      updates.push(`title = $${updates.length + 1}`);
      values.push(body.title);
    }

    if (body.description !== undefined) {
      updates.push(`description = $${updates.length + 1}`);
      values.push(body.description);
    }

    if (body.is_public !== undefined) {
      updates.push(`is_public = $${updates.length + 1}`);
      values.push(body.is_public);
    }

    if (updates.length === 0) {
      return sendJson(res, 400, { error: 'No fields to update' });
    }

    updates.push('updated_at = NOW()');

    const result = await sql.query(
      `UPDATE storyworlds
       SET ${updates.join(', ')}
       WHERE id = $${updates.length + 1}
       RETURNING *`,
      [...values, id]
    );

    if (result.rows.length === 0) {
      return sendJson(res, 404, { error: 'Storyworld not found' });
    }

    return sendJson(res, 200, {
      success: true,
      storyworld: result.rows[0],
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'Failed to update storyworld',
      details: error.message,
    });
  }
}

async function deleteStoryworld(req, res) {
  try {
    const { id } = req.query;
    const result = await sql`
      DELETE FROM storyworlds
      WHERE id = ${id}
      RETURNING id
    `;

    if (result.rows.length === 0) {
      return sendJson(res, 404, { error: 'Storyworld not found' });
    }

    return sendJson(res, 200, {
      success: true,
      message: 'Storyworld deleted',
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'Failed to delete storyworld',
      details: error.message,
    });
  }
}
