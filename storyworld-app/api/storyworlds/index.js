import { sql } from '@vercel/postgres';
import { hasPostgresConfig, methodNotAllowed, parseNumber, readJsonBody, sendJson } from '../_lib.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return listStoryworlds(req, res);
  }

  if (req.method === 'POST') {
    return createStoryworld(req, res);
  }

  return methodNotAllowed(res, ['GET', 'POST']);
}

async function createStoryworld(req, res) {
  try {
    if (!hasPostgresConfig()) {
      return sendJson(res, 503, {
        error: 'Storyworld database is not connected yet',
      });
    }

    const body = await readJsonBody(req);
    const {
      title,
      description,
      num_characters,
      num_themes,
      num_variables,
      encounter_length,
      custom_prompt,
      encounter,
      system_prompt,
      is_public = true,
      model_used = 'gpt-4.1',
      temperature = 0.8,
    } = body;

    if (!title || !encounter || !num_characters || !num_themes || !num_variables || !encounter_length) {
      return sendJson(res, 400, { error: 'Missing required fields' });
    }

    const result = await sql`
      INSERT INTO storyworlds (
        title,
        description,
        num_characters,
        num_themes,
        num_variables,
        encounter_length,
        custom_prompt,
        encounter,
        system_prompt,
        is_public,
        model_used,
        temperature
      ) VALUES (
        ${title},
        ${description ?? null},
        ${num_characters},
        ${num_themes},
        ${num_variables},
        ${encounter_length},
        ${custom_prompt ?? null},
        ${JSON.stringify(encounter)},
        ${system_prompt ?? null},
        ${is_public},
        ${model_used},
        ${temperature}
      )
      RETURNING *
    `;

    return sendJson(res, 201, {
      success: true,
      storyworld: result.rows[0],
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'Failed to create storyworld',
      details: error.message,
    });
  }
}

async function listStoryworlds(req, res) {
  try {
    if (!hasPostgresConfig()) {
      return sendJson(res, 503, {
        error: 'Storyworld database is not connected yet',
        storyworlds: [],
        total: 0,
        limit: 20,
        offset: 0,
      });
    }

    const limit = parseNumber(req.query.limit, 20);
    const offset = parseNumber(req.query.offset, 0);
    const sort = req.query.sort || 'created_at';
    const order = req.query.order === 'asc' ? 'ASC' : 'DESC';
    const allowedSorts = ['created_at', 'views', 'likes', 'fork_count'];
    const sortField = allowedSorts.includes(sort) ? sort : 'created_at';

    const result = await sql.query(
      `SELECT
        id,
        title,
        description,
        num_characters,
        num_themes,
        num_variables,
        encounter_length,
        custom_prompt,
        encounter,
        views,
        likes,
        fork_count,
        model_used,
        created_at
      FROM storyworlds
      WHERE is_public = true
      ORDER BY ${sortField} ${order}
      LIMIT $1
      OFFSET $2`,
      [limit, offset]
    );

    const countResult = await sql`
      SELECT COUNT(*) AS total
      FROM storyworlds
      WHERE is_public = true
    `;

    return sendJson(res, 200, {
      storyworlds: result.rows,
      total: Number.parseInt(countResult.rows[0].total, 10),
      limit,
      offset,
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'Failed to fetch storyworlds',
      details: error.message,
    });
  }
}
