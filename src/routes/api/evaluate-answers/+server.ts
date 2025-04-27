import { json, error as svelteKitError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { OPENROUTER_API_KEY, OPENROUTER_MODEL } from '$env/static/private';
// *** Import new types ***
import type { EvaluateAnswersRequest, EvaluateAnswersResponse, AnswerRecord } from '$lib/types';
import { PROFESSIONAL_VALUES } from '$lib/constants';

const OPENROUTER_API_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
// Use the model specified in the environment variable - MUST support json_schema
const AI_MODEL = OPENROUTER_MODEL || 'anthropic/claude-3-haiku-20240307'; // Default to a known compatible model

// --- Define the JSON Schema for the evaluation response ---
const evaluationSchema = {
	name: 'evaluateQuizAnswers',
	strict: true,
	schema: {
		type: 'object',
		properties: {
			top5Values: {
				type: 'array',
				minItems: 5,
				maxItems: 5,
				description:
					"An array containing exactly 5 strings, representing the user's top professional values based on their entire answer history.",
				items: {
					type: 'string',
					enum: PROFESSIONAL_VALUES, // Ensure values are from the master list
					description: 'An exact professional value name from the predefined list.'
				}
			}
		},
		required: ['top5Values'],
		additionalProperties: false
	}
};

// --- System Prompt for Evaluation ---
const EVALUATION_SYSTEM_PROMPT = `You are an AI assistant specialized in analyzing user choices to determine their core professional values.
You will receive a history of the user's answers throughout a quiz and their final point-based scores for context.
Your task is to analyze the *pattern* of choices across the entire quiz history, considering both direct value hints and the trade-offs made in forced-choice/ranking questions.
Based on this holistic analysis, determine the user's top 5 most prominent professional values from the provided list.

Here is the list of the 52 valid professional values:
${PROFESSIONAL_VALUES.join(', ')}

The user's answer history will be provided as an array of objects, each containing the question, the user's answer, and the values involved. The final scores are also provided for context but prioritize the choice patterns in the history.

You MUST respond ONLY with a JSON object that strictly adheres to the provided 'evaluateQuizAnswers' JSON schema. Your response should contain ONLY the 'top5Values' array with exactly 5 value strings from the list above. Do not include explanations or any other text outside the JSON object.`;

// --- Request Handler ---
export const POST: RequestHandler = async ({ request }) => {
	if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY === 'your_openrouter_api_key_here') {
		console.error('OpenRouter API key is not configured in .env');
		throw svelteKitError(500, 'AI service is not configured on the server.');
	}
	if (!OPENROUTER_MODEL) {
		console.warn(
			`EVALUATION: OPENROUTER_MODEL environment variable not set, using default '${AI_MODEL}'. Ensure this model supports json_schema.`
		);
	}

	let requestData: EvaluateAnswersRequest;
	try {
		requestData = await request.json();
	} catch (err) {
		console.error('Failed to parse evaluation request JSON:', err);
		throw svelteKitError(400, 'Invalid request body for evaluation.');
	}

	const { history, finalScores } = requestData;

	if (!history || !Array.isArray(history) || history.length === 0) {
		throw svelteKitError(400, 'Missing or invalid answer history for evaluation.');
	}

	// --- Construct the prompt for the AI ---
	// Format history and scores for the prompt
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

	const userPrompt = `Analyze the following quiz history and final scores to determine the user's top 5 professional values.\n\nQuiz History:\n${historyString}\n\nFinal Scores (for context):\n${scoresString}\n\nRespond using the 'evaluateQuizAnswers' JSON schema.`;

	const messages = [
		{ role: 'system', content: EVALUATION_SYSTEM_PROMPT },
		{ role: 'user', content: userPrompt }
	];

	try {
		console.log(`Calling OpenRouter (${AI_MODEL}) for final evaluation...`);
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
					json_schema: evaluationSchema // Use the evaluation schema
				}
				// Optional: Increase max_tokens if history is long
				// max_tokens: 1000,
			})
		});

		const data = await response.json();

		// Check for error object in the response body
		if (data && data.error) {
			console.error(
				`Evaluation API returned an error object (HTTP Status: ${response.status}):`,
				JSON.stringify(data.error, null, 2)
			);
			if (data.error.code === 429 || response.status === 429) {
				throw svelteKitError(
					429,
					'Rate limit exceeded during evaluation. Please wait and try again.'
				);
			}
			const errorMessage =
				data.error.message || 'AI evaluation service returned an unspecified error.';
			const status = response.status >= 400 ? response.status : 500;
			throw svelteKitError(status, `AI evaluation error: ${errorMessage}`);
		}

		if (!response.ok) {
			console.error(
				`Evaluation API error (${response.status}) with unexpected body:`,
				JSON.stringify(data, null, 2)
			);
			throw svelteKitError(response.status, `AI evaluation service error: ${response.statusText}`);
		}

		// Validate success response structure
		if (
			!data.choices ||
			!Array.isArray(data.choices) ||
			data.choices.length === 0 ||
			!data.choices[0] ||
			!data.choices[0].message ||
			!data.choices[0].message.content
		) {
			console.error(
				'Invalid success response structure during evaluation:',
				JSON.stringify(data, null, 2)
			);
			throw svelteKitError(
				500,
				'AI evaluation service returned an invalid success response structure.'
			);
		}

		let evaluationResult: EvaluateAnswersResponse;
		try {
			const rawContent = data.choices[0].message.content;
			console.log('Raw AI evaluation response content (expected JSON):', rawContent);
			evaluationResult = JSON.parse(rawContent);
			console.log('Received AI Evaluation (parsed):', evaluationResult);

			// Validate the parsed result against expectations (schema should handle most)
			if (
				!evaluationResult.top5Values ||
				!Array.isArray(evaluationResult.top5Values) ||
				evaluationResult.top5Values.length !== 5
			) {
				throw new Error(
					"Evaluation response did not contain a valid 'top5Values' array of 5 strings."
				);
			}
			// Double-check values are from the list (schema enum should catch this)
			for (const val of evaluationResult.top5Values) {
				if (!PROFESSIONAL_VALUES.includes(val)) {
					throw new Error(
						`Evaluated value "${val}" is not one of the 52 predefined professional values.`
					);
				}
			}
		} catch (parseOrValidationError: any) {
			console.error(
				'Failed to parse or validate JSON from AI evaluation response:',
				parseOrValidationError
			);
			if (
				data.choices &&
				data.choices[0] &&
				data.choices[0].message &&
				data.choices[0].message.content
			) {
				console.error(
					'Original Raw AI evaluation response content (on error):',
					data.choices[0].message.content
				);
			}
			throw svelteKitError(
				500,
				`AI evaluation response handling error: ${parseOrValidationError.message}`
			);
		}

		// Return the validated evaluation result
		return json(evaluationResult);
	} catch (err: any) {
		console.error('Error during AI evaluation call or processing:', err);
		if (err.status && err.body) {
			throw err; // Re-throw SvelteKit errors
		}
		throw svelteKitError(500, 'Failed to evaluate answers due to an internal server error.');
	}
};
