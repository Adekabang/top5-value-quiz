import { json, error as svelteKitError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
// Import both API Key and Model Name from environment variables
import { OPENROUTER_API_KEY, OPENROUTER_MODEL } from '$env/static/private';
import type { GenerateQuestionRequest, GenerateQuestionResponse, ValueScores } from '$lib/types';
import { PROFESSIONAL_VALUES } from '$lib/constants';

const OPENROUTER_API_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
// Use the model specified in the environment variable - MUST support json_schema
// Default to a known compatible model if not set
const AI_MODEL = OPENROUTER_MODEL || 'anthropic/claude-3-haiku-20240307';

// --- Define the JSON Schema for the expected response ---
const quizQuestionSchema = {
	name: 'generateQuizQuestion', // Function/tool name for the model
	strict: true, // Enforce schema strictly
	schema: {
		type: 'object',
		properties: {
			id: {
				type: 'string',
				description:
					'A unique identifier string for this specific question (e.g., timestamp, random string).'
			},
			type: {
				type: 'string',
				enum: ['forced_choice', 'ranking'], // Enforce specific values
				description:
					"The type of question: 'forced_choice' (compare 2 values) or 'ranking' (rank 3-4 values)."
			},
			text: {
				type: 'string',
				description:
					'The question text to be presented to the user, framed in a professional context or scenario.'
			},
			options: {
				type: 'array',
				minItems: 2, // Must have at least 2 options
				maxItems: 4, // Can have up to 4 (for ranking)
				description:
					"An array of options for the user to choose from. MUST contain exactly 2 objects for 'forced_choice' type, and 3 or 4 objects for 'ranking' type.",
				items: {
					type: 'object',
					properties: {
						text: {
							type: 'string',
							description:
								'The text of the option presented to the user (can be the value name or a descriptive phrase).'
						}
					},
					required: ['text'], // Each option object must have 'text'
					additionalProperties: false // No other properties allowed in option objects
				}
			},
			values_being_compared: {
				type: 'array',
				minItems: 2, // Must compare at least 2 values
				description: `An array containing the exact string names of the professional values being compared. EACH string MUST be one of the predefined 52 values.`,
				items: {
					type: 'string',
					// *** CRITICAL SCHEMA CONSTRAINT ***
					enum: PROFESSIONAL_VALUES,
					description: 'An exact professional value name from the predefined list.'
				}
			}
		},
		required: ['id', 'type', 'text', 'options', 'values_being_compared'], // All top-level fields are required
		additionalProperties: false // Disallow any extra top-level properties
	}
};

// --- System Prompt (v7 - Simplified for Schema Usage) ---
const SYSTEM_PROMPT = `You are an AI assistant generating quiz questions to help a user identify their top 5 professional values.
Your goal is to create informative questions based on the user's current value scores.

You MUST respond ONLY with a JSON object that strictly adheres to the provided 'generateQuizQuestion' JSON schema.

Here is the list of the 52 valid professional values:
${PROFESSIONAL_VALUES.join(', ')}

Key Logic for Question Generation:
- Receive current scores and remaining questions.
- Generate the next question (either 'forced_choice' or 'ranking' type, unless specifically instructed otherwise in the user prompt).
- Focus on comparing values with high or similar scores to differentiate them.
- Occasionally include lower-scored values to give them a chance.
- Ensure the 'values_being_compared' array in your JSON output contains ONLY exact string matches from the provided list of 52 values.
- Ensure the number of items in the 'options' array matches the question 'type' (2 for forced_choice, 3-4 for ranking).
- Frame the question 'text' in a simple, professional scenario.

Remember: Your entire output must be the JSON object conforming to the schema. No extra text.`;

// --- Request Handler ---
export const POST: RequestHandler = async ({ request }) => {
	// Check if API key is configured
	if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY === 'your_openrouter_api_key_here') {
		console.error('OpenRouter API key is not configured in .env');
		throw svelteKitError(500, 'AI service is not configured on the server.');
	}
	// Optional: Check if model name is configured, otherwise use fallback
	if (!OPENROUTER_MODEL) {
		console.warn(
			`OPENROUTER_MODEL environment variable not set, using default '${AI_MODEL}'. Ensure this model supports json_schema.`
		);
	}

	let requestData: GenerateQuestionRequest;

	// Parse request body
	try {
		requestData = await request.json();
	} catch (err) {
		console.error('Failed to parse request JSON:', err);
		throw svelteKitError(400, 'Invalid request body.');
	}

	const { scores, remainingQuestions } = requestData;

	// --- *** NEW: Analyze Scores to Determine Desired Question Type *** ---
	let desiredType: 'ranking' | 'forced_choice' | 'auto' = 'auto'; // Default: let AI decide

	try {
		const sortedScores = Object.entries(scores)
			.filter(([, score]) => score > 0) // Consider only values with positive scores
			.sort(([, scoreA], [, scoreB]) => scoreB - scoreA);

		// Heuristic: If 4 or more values are clustered near the top
		if (sortedScores.length >= 4) {
			const scoreThreshold = sortedScores[3][1]; // Score of the 4th highest value
			// Ensure threshold is positive to avoid issues with many zeros/negatives
			if (scoreThreshold > 0) {
				const countAtOrAboveThreshold = sortedScores.filter(
					([, score]) => score >= scoreThreshold
				).length;

				if (countAtOrAboveThreshold >= 4) {
					console.log(
						`Score analysis: ${countAtOrAboveThreshold} values >= score ${scoreThreshold}. Requesting ranking.`
					);
					desiredType = 'ranking';
				}
			}
		}

		// Add randomness: ~20% chance to let AI decide even if heuristic suggests ranking
		if (desiredType === 'ranking' && Math.random() < 0.2) {
			console.log("Score analysis: Randomly overriding ranking request to 'auto'.");
			desiredType = 'auto';
		}
	} catch (analysisError) {
		console.error('Error during score analysis:', analysisError);
		// Default to 'auto' if analysis fails
		desiredType = 'auto';
	}
	// --- *** End of Score Analysis Logic *** ---

	// --- Construct the prompt for the AI ---
	const scoresString = Object.entries(scores)
		.sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
		.map(([value, score]) => `${value}: ${score}`)
		.join(', ');

	// Modify user prompt based on desired type
	let userPrompt = `Current scores: ${scoresString}. Questions remaining: ${remainingQuestions}. Generate the next question using the 'generateQuizQuestion' JSON schema.`;
	if (desiredType === 'ranking') {
		userPrompt += " The question 'type' MUST be 'ranking'.";
		console.log('Instructing AI to generate RANKING question.');
	} else if (desiredType === 'forced_choice') {
		// Example if you wanted to force forced_choice sometimes
		userPrompt += " The question 'type' MUST be 'forced_choice'.";
		console.log('Instructing AI to generate FORCED_CHOICE question.');
	} else {
		console.log("Letting AI choose question type ('auto').");
	}

	const messages = [
		{ role: 'system', content: SYSTEM_PROMPT },
		{ role: 'user', content: userPrompt }
	];

	// --- Call OpenRouter API ---
	try {
		console.log(`Calling OpenRouter (${AI_MODEL}) with JSON Schema for next question...`);
		const response = await fetch(OPENROUTER_API_ENDPOINT, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${OPENROUTER_API_KEY}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: AI_MODEL,
				messages: messages,
				// *** USE JSON SCHEMA ***
				response_format: {
					type: 'json_schema',
					json_schema: quizQuestionSchema
				}
			})
		});

		// Note: We parse the body regardless of status code first
		const data = await response.json();

		// Check for error object in the response body
		if (data && data.error) {
			console.error(
				`OpenRouter API returned an error object (HTTP Status: ${response.status}):`,
				JSON.stringify(data.error, null, 2)
			);
			// Check specifically for rate limit error code 429
			if (data.error.code === 429 || response.status === 429) {
				throw svelteKitError(429, 'Rate limit exceeded. Please wait a moment and try again.');
			}
			// For other errors in the body, use the message if available
			const errorMessage = data.error.message || 'AI service returned an unspecified error.';
			// Use the original response status if it indicates an error, otherwise default to 500
			const status = response.status >= 400 ? response.status : 500;
			throw svelteKitError(status, `AI service error: ${errorMessage}`);
		}

		// If the *status code* itself indicates an error, but there was no error object in the body
		if (!response.ok) {
			console.error(
				`OpenRouter API error (${response.status}) with unexpected body:`,
				JSON.stringify(data, null, 2)
			);
			throw svelteKitError(response.status, `AI service error: ${response.statusText}`);
		}

		// --- Validate and Parse SUCCESSFUL AI Response ---
		// Check basic structure from OpenRouter - WITH VERBOSE LOGGING
		if (
			!data.choices || // Check if choices array exists
			!Array.isArray(data.choices) || // Check if choices is an array
			data.choices.length === 0 || // Check if choices array is empty
			!data.choices[0] || // Check if the first choice exists
			!data.choices[0].message || // Check if message object exists
			!data.choices[0].message.content // Check if content exists
		) {
			// Log the problematic structure received from the API in detail
			console.error(
				"Invalid success response structure received from OpenRouter. Expected 'choices[0].message.content' path to exist and be non-empty. Received structure:",
				JSON.stringify(data, null, 2) // Pretty-print the received data object
			);
			// Keep the client-facing error message relatively concise, but the server log now has details
			throw svelteKitError(
				500,
				'AI service returned an invalid success response structure (check server logs for details).'
			);
		}

		let aiResponseContent: GenerateQuestionResponse;
		try {
			// The content should already be the valid JSON object string
			const rawContent = data.choices[0].message.content;
			console.log('Raw AI response content (expected JSON):', rawContent);

			// Parse the JSON (extraction/cleaning should no longer be needed)
			aiResponseContent = JSON.parse(rawContent);
			console.log('Received AI Response (parsed):', aiResponseContent);

			// Optional: Minimal validation as a safety check (schema should prevent these)
			if (
				!aiResponseContent.id ||
				!aiResponseContent.type ||
				!aiResponseContent.text ||
				!aiResponseContent.options ||
				!aiResponseContent.values_being_compared
			) {
				console.warn('Parsed AI response missing expected fields despite schema request.');
			}
			// Example: Double-check a constraint handled by schema enum as a safety measure
			for (const val of aiResponseContent.values_being_compared) {
				if (!PROFESSIONAL_VALUES.includes(val)) {
					console.error(
						'Validation Error: Value found not in master list despite schema enum:',
						val
					);
					throw new Error(
						`Value "${val}" in 'values_being_compared' is not one of the 52 predefined values. Schema enforcement might have failed or model ignored it.`
					);
				}
			}
		} catch (parseOrValidationError: any) {
			console.error(
				'Failed to parse or validate JSON from AI response content:',
				parseOrValidationError
			);
			if (
				data.choices &&
				data.choices[0] &&
				data.choices[0].message &&
				data.choices[0].message.content
			) {
				console.error(
					'Original Raw AI response content (on error):',
					data.choices[0].message.content
				);
			}
			throw svelteKitError(
				500,
				`AI service response handling error: ${parseOrValidationError.message}`
			);
		}

		// Return the validated (schema-enforced) question JSON
		return json(aiResponseContent);
	} catch (err: any) {
		// Catch errors from fetch, parsing, validation, or explicitly thrown svelteKitError
		console.error('Error during AI API call or processing:', err);
		// If it's already a SvelteKit error, re-throw it
		if (err.status && err.body) {
			throw err;
		}
		// Otherwise, wrap it in a generic 500 error
		throw svelteKitError(
			500,
			'Failed to generate the next question due to an internal server error.'
		);
	}
}; // End of POST handler
