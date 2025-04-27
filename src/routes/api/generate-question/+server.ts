import { json, error as svelteKitError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { OPENROUTER_API_KEY, OPENROUTER_MODEL } from '$env/static/private'; // Securely import API key
import type { GenerateQuestionRequest, GenerateQuestionResponse, ValueScores } from '$lib/types';
import { PROFESSIONAL_VALUES } from '$lib/constants'; // Import the list for the prompt

const OPENROUTER_API_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
// Define the model you want to use via OpenRouter (e.g., Claude, GPT, Gemini)
// Check OpenRouter docs for available models: https://openrouter.ai/docs#models
const AI_MODEL = OPENROUTER_MODEL; // Example: Use Gemini Pro

// --- Initial System Prompt ---
// (Keep this outside the handler to avoid redefining it on every request)
const SYSTEM_PROMPT = `You are an AI assistant designed to help a user identify their top 5 professional values from a predefined list of 52 values.

Your objective is to dynamically generate or select a series of forced-choice or ranking questions based on the user's previous answers and the current scores of the values. Each question should be a comparison designed to help differentiate the user's most important values in a professional context.

Here is the complete list of the 52 professional values:
${PROFESSIONAL_VALUES.join(', ')}

You will receive input representing the current state of the quiz. This input will include:
- The current score for each of the 52 values.
- The number of questions remaining in Phase 2.

Based on this input, you must determine the most informative question to ask next. Your goal is to select or generate a question that will provide the most useful information for narrowing down the user's top 5 values.

When generating questions:
- They must be either forced-choice (comparing two values) or ranking (comparing 3-4 values).
- They must be framed in a realistic professional scenario or context.
- You should primarily focus on comparing values that currently have high scores or similar scores, as these are the most likely candidates for the user's top values and need differentiation.
- HOWEVER, it is critical to occasionally include values that currently have low scores and have not been compared frequently. This ensures that less-hinted values have a chance to be identified if they are important to the user. Strategically pair these less-hinted values with values the user has shown some interest in to make the comparison relevant.
- Ensure the vocabulary is simple and easy to understand for an international audience.
- Generate a unique ID for each question (e.g., a timestamp or random string).

Your output MUST be a single JSON object representing the question to be presented to the user. Do NOT include any markdown formatting (like \`\`\`json) or any other text outside the JSON object itself. The JSON format should be strictly:
{
  "id": "[unique question ID string]",
  "type": "forced_choice" | "ranking",
  "text": "[Question text here, phrased as a professional scenario or choice]",
  "options": [
    {"text": "[Option 1 value or descriptive text related to the value]"},
    {"text": "[Option 2 value or descriptive text related to the value]"}
    // ... more options for ranking (up to 4 total)
  ],
  "values_being_compared": ["[Value A]", "[Value B]", ...] // List the *exact* value names from the list being compared
}
DO NOT PUT the JSON code in markdown just return the JSON object directly as a text. NO OTHER TEXT EXCEPT JSON OBJECT. PLEASE make sure not in markdown.
Do NOT provide any text or explanation outside of the requested JSON object. Start by generating the first question based on the initial scores provided.`;

// --- Request Handler ---
export const POST: RequestHandler = async ({ request }) => {
	if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY === 'your_openrouter_api_key_here') {
		console.error('OpenRouter API key is not configured in .env');
		throw svelteKitError(500, 'AI service is not configured on the server.');
	}

	let requestData: GenerateQuestionRequest;

	try {
		requestData = await request.json();
	} catch (err) {
		console.error('Failed to parse request JSON:', err);
		throw svelteKitError(400, 'Invalid request body.');
	}

	const { scores, remainingQuestions } = requestData;

	// --- Construct the prompt for the AI ---
	// Convert scores object to a more readable format for the prompt
	const scoresString = Object.entries(scores)
		.sort(([, scoreA], [, scoreB]) => scoreB - scoreA) // Sort by score desc
		.map(([value, score]) => `${value}: ${score}`)
		.join(', ');

	const userPrompt = `Current scores: ${scoresString}. Questions remaining: ${remainingQuestions}. Generate the next question.`;

	// Construct the messages array for the OpenRouter API
	const messages = [
		{ role: 'system', content: SYSTEM_PROMPT },
		{ role: 'user', content: userPrompt }
		// TODO: Potentially add history of previous questions/answers here if needed
	];

	// --- Call OpenRouter API ---
	try {
		console.log(`Calling OpenRouter (${AI_MODEL}) for next question...`);
		const response = await fetch(OPENROUTER_API_ENDPOINT, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${OPENROUTER_API_KEY}`,
				'Content-Type': 'application/json'
				// Recommended headers by OpenRouter
				// 'HTTP-Referer': $YOUR_SITE_URL, // Optional
				// 'X-Title': $YOUR_SITE_NAME, // Optional
			},
			body: JSON.stringify({
				model: AI_MODEL,
				messages: messages,
				// Optional parameters (temperature, max_tokens, etc.)
				// temperature: 0.7,
				// max_tokens: 250,
				response_format: { type: 'json_object' } // Request JSON output if model supports it
			})
		});

		if (!response.ok) {
			const errorBody = await response.text();
			console.error(`OpenRouter API error (${response.status}): ${errorBody}`);
			throw svelteKitError(response.status, `AI service error: ${response.statusText}`);
		}

		const data = await response.json();

		// --- Validate and Parse AI Response ---
		// The actual content is nested in choices[0].message.content
		if (
			!data.choices ||
			!data.choices[0] ||
			!data.choices[0].message ||
			!data.choices[0].message.content
		) {
			console.error('Invalid response structure from OpenRouter:', data);
			throw svelteKitError(500, 'AI service returned an invalid response structure.');
		}

		let aiResponseContent: GenerateQuestionResponse;
		try {
			// The content itself should be the JSON string we asked for
			aiResponseContent = JSON.parse(data.choices[0].message.content);
			console.log('Received AI Response (parsed):', aiResponseContent);

			// Basic validation of the received structure
			if (
				!aiResponseContent.id ||
				!aiResponseContent.type ||
				!aiResponseContent.text ||
				!aiResponseContent.options ||
				!aiResponseContent.values_being_compared
			) {
				throw new Error('AI response missing required fields.');
			}
			if (!['forced_choice', 'ranking'].includes(aiResponseContent.type)) {
				throw new Error('Invalid question type in AI response.');
			}
			if (!Array.isArray(aiResponseContent.options) || aiResponseContent.options.length < 2) {
				throw new Error('Invalid options array in AI response.');
			}
			if (
				!Array.isArray(aiResponseContent.values_being_compared) ||
				aiResponseContent.values_being_compared.length < 2
			) {
				throw new Error('Invalid values_being_compared array in AI response.');
			}
		} catch (parseError) {
			console.error('Failed to parse JSON from AI response content:', parseError);
			console.error('Raw AI response content:', data.choices[0].message.content);
			throw svelteKitError(500, 'AI service returned malformed JSON.');
		}

		// Return the parsed question JSON to the frontend
		return json(aiResponseContent);
	} catch (err: any) {
		console.error('Error during AI API call or processing:', err);
		// Avoid leaking internal details; use the status/message from svelteKitError if available
		if (err.status) {
			throw err; // Re-throw SvelteKit errors
		}
		// Throw a generic internal server error for other cases
		throw svelteKitError(
			500,
			'Failed to generate the next question due to an internal server error.'
		);
	}
};
