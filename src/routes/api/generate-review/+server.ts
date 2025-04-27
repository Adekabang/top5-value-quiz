import { json, error as svelteKitError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { OPENROUTER_API_KEY, OPENROUTER_MODEL } from '$env/static/private';
// Use EvaluateAnswersRequest as input type, define ReviewResponse type
import type { EvaluateAnswersRequest, AnswerRecord, ValueScores, ReviewResponse } from '$lib/types';
import { PROFESSIONAL_VALUES } from '$lib/constants';

const OPENROUTER_API_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
// Use a capable model, preferably one supporting json_schema
const AI_MODEL = OPENROUTER_MODEL || 'anthropic/claude-3-haiku-20240307';

// --- Define the JSON Schema for the review response ---
const reviewSchema = {
	name: 'generateQuizReview',
	strict: true,
	schema: {
		type: 'object',
		properties: {
			reviewText: {
				type: 'string',
				description:
					'A concise (2-4 sentences) and insightful explanation summarizing why the user likely has their identified top values, based on their quiz answers and score patterns. Mention specific trade-offs or consistent choices if possible.'
			}
		},
		required: ['reviewText'],
		additionalProperties: false
	}
};

// --- System Prompt for Review Generation ---
const REVIEW_SYSTEM_PROMPT = `You are an AI assistant analyzing a user's professional values quiz results.
You will receive the user's full answer history and their final point scores.
Your task is to generate a brief (1 paragraph), insightful, and positive explanation for *why* the user might hold their top values, based on the patterns observed in their answers (trade-offs made, consistent themes). Do NOT simply list the top values. Explain the reasoning behind them based on the data. Give an example of why the final result is that by point out on the quiz history. do not give quiz number to point out the example, just give the example itself because they does not have the copy.

You MUST respond ONLY with a JSON object that strictly adheres to the provided 'generateQuizReview' JSON schema, containing only the 'reviewText' field.`;

// --- Request Handler ---
export const POST: RequestHandler = async ({ request }) => {
	if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY === 'your_openrouter_api_key_here') {
		console.error('OpenRouter API key is not configured in .env');
		throw svelteKitError(500, 'AI service is not configured on the server.');
	}
	if (!OPENROUTER_MODEL) {
		console.warn(
			`REVIEW: OPENROUTER_MODEL environment variable not set, using default '${AI_MODEL}'. Ensure this model supports json_schema.`
		);
	}

	let requestData: EvaluateAnswersRequest; // Reuse this type as input is the same
	try {
		requestData = await request.json();
	} catch (err) {
		console.error('Failed to parse review request JSON:', err);
		throw svelteKitError(400, 'Invalid request body for review generation.');
	}

	const { history, finalScores } = requestData;

	if (!history || !Array.isArray(history) || history.length === 0) {
		throw svelteKitError(400, 'Missing or invalid answer history for review generation.');
	}

	// --- Construct the prompt for the AI ---
	const historyString = history
		.map(
			(item, index) =>
				`Q${index + 1} (${item.questionType}): "${item.questionText}" | Answer: ${JSON.stringify(item.answer)} | Values Involved: ${item.valuesInvolved.join(', ')}`
		)
		.join('\n');
	const scoresString = Object.entries(finalScores)
		.sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
		.map(([value, score]) => `${value}: ${score}`)
		.join(', ');

	// We don't explicitly tell the AI the top 5, let it infer from the data provided
	const userPrompt = `Analyze the following quiz history and final scores to generate a brief explanation for the user's likely top values.\n\nQuiz History:\n${historyString}\n\nFinal Scores (for context):\n${scoresString}\n\nRespond using the 'generateQuizReview' JSON schema.`;

	const messages = [
		{ role: 'system', content: REVIEW_SYSTEM_PROMPT },
		{ role: 'user', content: userPrompt }
	];

	try {
		console.log(`Calling OpenRouter (${AI_MODEL}) for results review...`);
		const response = await fetch(OPENROUTER_API_ENDPOINT, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${OPENROUTER_API_KEY}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: AI_MODEL,
				messages: messages,
				response_format: {
					type: 'json_schema',
					json_schema: reviewSchema // Use the review schema
				}
				// temperature: 0.5 // Slightly higher temp might allow more insightful text
			})
		});

		const data = await response.json();

		// Check for error object in the response body
		if (data && data.error) {
			console.error(
				`Review API returned an error object (HTTP Status: ${response.status}):`,
				JSON.stringify(data.error, null, 2)
			);
			if (data.error.code === 429 || response.status === 429) {
				throw svelteKitError(429, 'Rate limit exceeded during review generation.');
			}
			const errorMessage = data.error.message || 'AI review service returned an unspecified error.';
			const status = response.status >= 400 ? response.status : 500;
			throw svelteKitError(status, `AI review error: ${errorMessage}`);
		}

		if (!response.ok) {
			console.error(
				`Review API error (${response.status}) with unexpected body:`,
				JSON.stringify(data, null, 2)
			);
			throw svelteKitError(response.status, `AI review service error: ${response.statusText}`);
		}

		// Validate success response structure
		if (
			!data.choices ||
			!Array.isArray(data.choices) ||
			data.choices.length === 0 ||
			!data.choices[0].message ||
			!data.choices[0].message.content
		) {
			console.error(
				'Invalid success response structure during review generation:',
				JSON.stringify(data, null, 2)
			);
			throw svelteKitError(
				500,
				'AI review service returned an invalid success response structure.'
			);
		}

		let reviewResult: ReviewResponse;
		try {
			const rawContent = data.choices[0].message.content;
			console.log('Raw AI review response content (expected JSON):', rawContent);
			reviewResult = JSON.parse(rawContent);
			console.log('Received AI Review (parsed):', reviewResult);

			// Validate the parsed result
			if (
				!reviewResult.reviewText ||
				typeof reviewResult.reviewText !== 'string' ||
				reviewResult.reviewText.trim() === ''
			) {
				throw new Error("Review response did not contain a valid 'reviewText' string.");
			}
		} catch (parseOrValidationError: any) {
			console.error(
				'Failed to parse or validate JSON from AI review response:',
				parseOrValidationError
			);
			if (
				data.choices &&
				data.choices[0] &&
				data.choices[0].message &&
				data.choices[0].message.content
			) {
				console.error(
					'Original Raw AI review response content (on error):',
					data.choices[0].message.content
				);
			}
			throw svelteKitError(
				500,
				`AI review response handling error: ${parseOrValidationError.message}`
			);
		}

		// Return the validated review result
		return json(reviewResult);
	} catch (err: any) {
		console.error('Error during AI review call or processing:', err);
		if (err.status && err.body) {
			throw err; // Re-throw SvelteKit errors
		}
		throw svelteKitError(500, 'Failed to generate review due to an internal server error.');
	}
};
