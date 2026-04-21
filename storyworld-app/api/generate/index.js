import { methodNotAllowed, readJsonBody, sendJson } from '../_lib.js';

function buildSystemPrompt(config, customPrompt = '') {
  const {
    numCharacters = 3,
    numThemes = 2,
    numVariables = 5,
    encounterLength = 500,
  } = config || {};

  return `You are a Sweepweave Storyworld generator. Create an interactive narrative environment with the following parameters:

- Characters: ${numCharacters} distinct characters with unique motivations and relationships
- Themes: ${numThemes} central thematic elements that weave through the narrative
- Variables: ${numVariables} trackable state variables that affect story progression
- Encounter Length: Approximately ${encounterLength} words per scene

Each encounter should:
1. Present meaningful choices that affect character relationships and tracked variables
2. Maintain consistency with established lore and character personalities
3. Create branching possibilities for future encounters
4. Balance narrative coherence with player agency

${customPrompt ? `\nAdditional Instructions:\n${customPrompt}` : ''}

Structure the output as valid JSON with:
{
  "encounter": "narrative text",
  "choices": ["choice1", "choice2", "choice3"],
  "variables_affected": {"var_name": "delta"},
  "metadata": {
    "characters_present": [],
    "themes_emphasized": [],
    "narrative_weight": 0
  }
}`;
}

function extractJson(content) {
  if (!content || typeof content !== 'string') {
    return null;
  }

  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(content.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  try {
    const token = process.env.OPENAI_API_KEY;
    if (!token) {
      return sendJson(res, 500, {
        error: 'OPENAI_API_KEY is not configured on the server',
      });
    }

    const body = await readJsonBody(req);
    const systemPrompt = body.system_prompt || buildSystemPrompt(body.config, body.custom_prompt);
    const model = process.env.OPENAI_MODEL || 'gpt-4.1';

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Generate the first encounter of this storyworld.' },
        ],
        temperature: 0.8,
        response_format: { type: 'json_object' },
        max_tokens: (body.config?.encounterLength || 500) * 2,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return sendJson(res, response.status, {
        error: data?.error?.message || 'OpenAI request failed',
        details: data,
      });
    }

    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = extractJson(content);

    return sendJson(res, 200, {
      success: true,
      model,
      content,
      parsed,
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'Failed to generate storyworld',
      details: error.message,
    });
  }
}
