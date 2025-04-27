<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	// Import the new store
	import {
		quizPhase,
		valueScores,
		currentQuestionIndex,
		currentPhase2Question,
		errorMessage,
		retryPossible,
		resetQuiz,
		clearLocalStorage
	} from '$lib/stores';
	import {
		PROFESSIONAL_VALUES,
		TOTAL_PHASE_1_QUESTIONS,
		TOTAL_PHASE_2_QUESTIONS,
		TOTAL_QUESTIONS
	} from '$lib/constants';
	import type {
		Phase1Question,
		Phase2Question,
		ValueScores,
		Phase1Option,
		Phase2Option,
		QuizQuestion
	} from '$lib/types';
	import QuestionCard from '$lib/components/QuestionCard.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import ResultsDisplay from '$lib/components/ResultsDisplay.svelte';

	let phase1Questions: Phase1Question[] = [];
	let currentQuestion: QuizQuestion | null = null;
	let isLoading = false;
	let showResumePrompt = false;

	// Load Phase 1 questions on mount
	onMount(async () => {
		try {
			const response = await fetch('/phase1_questions.json');
			if (!response.ok) throw new Error('Failed to load Phase 1 questions');
			phase1Questions = await response.json();

			// Check if there's progress in localStorage
			if (
				browser &&
				localStorage.getItem('valueScores') &&
				$currentQuestionIndex > 0 &&
				$currentQuestionIndex < TOTAL_QUESTIONS
			) {
				// Don't automatically resume, ask the user
				showResumePrompt = true;
			} else if ($currentQuestionIndex === 0) {
				// If index is 0, ensure state is fully reset
				clearLocalStorage(); // Clear any potentially inconsistent state
				quizPhase.set('start');
			} else {
				// If already finished or beyond expected range, reset
				if ($currentQuestionIndex >= TOTAL_QUESTIONS) {
					quizPhase.set('results');
				} else {
					// Determine phase based on index if not starting/finished
					determinePhaseAndQuestion();
				}
			}
		} catch (err: any) {
			console.error('Error loading Phase 1 questions:', err);
			errorMessage.set(`Error loading initial data: ${err.message}`);
			quizPhase.set('error'); // Keep 'error' phase for critical load failures
			retryPossible.set(false); // No retry for initial load error
		}
	});

	function resumeQuiz() {
		showResumePrompt = false;
		determinePhaseAndQuestion(); // Load the correct question based on stored index
	}

	function startNewQuiz() {
		showResumePrompt = false;
		resetQuiz(); // Fully resets stores and localStorage
		quizPhase.set('start');
	}

	function startQuiz() {
		resetQuiz(); // Ensure clean start
		quizPhase.set('phase1');
		currentQuestionIndex.set(1); // Start at question 1
		setCurrentQuestion();
	}

	// Determine current question based on index
	function setCurrentQuestion() {
		const index = $currentQuestionIndex;
		if ($quizPhase === 'phase1' && index > 0 && index <= TOTAL_PHASE_1_QUESTIONS) {
			currentQuestion = phase1Questions[index - 1];
		} else if ($quizPhase === 'phase2' && $currentPhase2Question) {
			currentQuestion = $currentPhase2Question;
		} else {
			currentQuestion = null; // Should not happen in normal flow
		}
	}

	// Fetch the next Phase 2 question from the backend
	async function fetchNextPhase2Question() {
		if ($quizPhase !== 'phase2') return; // Should only be called in Phase 2

		isLoading = true;
		errorMessage.set(null);
		retryPossible.set(false); // Reset retry state before attempting fetch
		// Keep currentPhase2Question null while loading
		// currentPhase2Question.set(null); // Already set to null by handleAnswer or determinePhase

		const remaining = TOTAL_QUESTIONS - $currentQuestionIndex + 1; // Correct calculation

		try {
			const response = await fetch('/api/generate-question', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					scores: $valueScores,
					valuesList: PROFESSIONAL_VALUES,
					remainingQuestions: remaining
				})
			});

			// Check if the response status indicates an error
			if (!response.ok) {
				let errorMsg = `API Error (${response.status})`;
				try {
					// Try to get more specific error from response body
					const errorData = await response.json();
					errorMsg = errorData.message || errorMsg; // Use message from body if available
				} catch (e) {
					// If body parsing fails, use status text
					errorMsg = `${errorMsg}: ${response.statusText}`;
				}

				// Throw an error object containing status and message
				const error: any = new Error(errorMsg);
				error.status = response.status; // Attach status code to the error
				throw error;
			}

			// If response is OK, parse the question
			const nextQuestion: Phase2Question = await response.json();
			currentPhase2Question.set(nextQuestion);
			setCurrentQuestion(); // Update the displayed question
		} catch (err: any) {
			console.error('Error fetching Phase 2 question:', err);

			// Set error message based on status code or generic message
			if (err.status === 429) {
				errorMessage.set('Rate limit reached. Please wait a moment and try again.');
			} else {
				errorMessage.set(`Failed to get next question: ${err.message || 'Unknown error'}`);
			}
			// *** Enable retry for API errors ***
			retryPossible.set(true);
			// Do NOT change quizPhase here, stay in phase2 to allow retry
		} finally {
			isLoading = false;
		}
	}

	// Function to handle retry
	function retryFetchQuestion() {
		console.log('Retrying fetchNextPhase2Question...');
		// No need to reset state here, just call the fetch function again
		fetchNextPhase2Question();
	}

	// Handle user answering a question
	function handleAnswer(selectedOption: Phase1Option | Phase2Option | Phase2Option[]) {
		if (!currentQuestion || isLoading || $retryPossible) return; // Prevent answering while loading or if an error needs retry

		// --- Apply Scoring Logic ---
		let updatedScores = { ...$valueScores };

		if (currentQuestion.type === 'simple_choice' && 'value_area_hint' in selectedOption) {
			// Phase 1 Scoring
			(selectedOption as Phase1Option).value_area_hint.forEach((value) => {
				if (updatedScores.hasOwnProperty(value)) {
					updatedScores[value]++;
				}
			});
		} else if (currentQuestion.type === 'forced_choice' && 'text' in selectedOption) {
			// Phase 2 Forced Choice Scoring
			const chosenValueText = (selectedOption as Phase2Option).text;
			const comparedValues = (currentQuestion as Phase2Question).values_being_compared;
			const chosenValue = comparedValues.find((v) => chosenValueText.includes(v)); // Simple check
			const otherValue = comparedValues.find((v) => v !== chosenValue);

			if (chosenValue && updatedScores.hasOwnProperty(chosenValue)) {
				updatedScores[chosenValue] += 2;
			}
			if (otherValue && updatedScores.hasOwnProperty(otherValue)) {
				updatedScores[otherValue] -= 1; // Penalty for not chosen
			}
		} else if (currentQuestion.type === 'ranking' && Array.isArray(selectedOption)) {
			// Phase 2 Ranking Scoring
			const rankedOptions = selectedOption as Phase2Option[];
			const comparedValues = (currentQuestion as Phase2Question).values_being_compared;

			rankedOptions.forEach((option, index) => {
				const rank = index + 1; // 1-based rank
				const points = Math.max(0, 4 - rank); // Rank 1: +3, Rank 2: +2, Rank 3: +1, Rank 4: 0
				const value = comparedValues.find((v) => option.text.includes(v)); // Simple check
				if (value && updatedScores.hasOwnProperty(value)) {
					updatedScores[value] += points;
				}
			});
		}

		valueScores.set(updatedScores); // Update the store

		// --- Advance Quiz ---
		const nextIndex = $currentQuestionIndex + 1;

		if (nextIndex <= TOTAL_PHASE_1_QUESTIONS) {
			// Still in Phase 1
			currentQuestionIndex.set(nextIndex);
			quizPhase.set('phase1');
			setCurrentQuestion();
		} else if (nextIndex <= TOTAL_QUESTIONS) {
			// Entering or continuing Phase 2
			currentQuestionIndex.set(nextIndex);
			quizPhase.set('phase2');
			// *** REMOVED fetchNextPhase2Question() call from here ***
			// *** INSTEAD: Signal that the next question is needed by clearing the current one ***
			// This allows the reactive statement below to trigger the fetch exactly once.
			currentPhase2Question.set(null);
		} else {
			// Quiz finished
			quizPhase.set('results');
			currentQuestionIndex.set(nextIndex); // Mark as completed
			currentQuestion = null;
			currentPhase2Question.set(null); // Clear question state
		}
	}

	// Reactive statement to determine phase and load question if phase/index changes
	$: if (browser && !showResumePrompt) {
		// Only run in browser and when not showing resume prompt
		determinePhaseAndQuestion($quizPhase, $currentQuestionIndex);
	}

	function determinePhaseAndQuestion(phase = $quizPhase, index = $currentQuestionIndex) {
		// Reset error/retry state when determining question (unless loading is in progress)
		if (!isLoading) {
			errorMessage.set(null);
			retryPossible.set(false);
		}

		if (phase === 'start' || phase === 'results' || phase === 'error') {
			// Keep error phase for critical errors
			currentQuestion = null;
			return;
		}

		if (index > 0 && index <= TOTAL_PHASE_1_QUESTIONS) {
			if (phase !== 'phase1') quizPhase.set('phase1'); // Correct phase if needed
			if (phase1Questions.length > 0) {
				currentQuestion = phase1Questions[index - 1];
			} else {
				// Questions not loaded yet, wait for onMount
			}
		} else if (index > TOTAL_PHASE_1_QUESTIONS && index <= TOTAL_QUESTIONS) {
			if (phase !== 'phase2') quizPhase.set('phase2'); // Correct phase if needed
			// Fetch question only if not already loaded for this index and not currently loading
			if (!$currentPhase2Question && !isLoading) {
				fetchNextPhase2Question(); // Fetch is triggered here based on state
			} else if ($currentPhase2Question) {
				// If question is already loaded (e.g., after successful fetch or resume), display it
				currentQuestion = $currentPhase2Question;
			}
		} else if (index > TOTAL_QUESTIONS) {
			if (phase !== 'results') quizPhase.set('results');
			currentQuestion = null;
		} else {
			// Default to start if index is 0 or invalid
			if (phase !== 'start') quizPhase.set('start');
			currentQuestion = null;
		}
	}
</script>

<svelte:head>
	<title>Top 5 Professional Values Quiz</title>
	<meta
		name="description"
		content="Discover your top 5 professional values with this interactive quiz."
	/>
</svelte:head>

<main class="container mx-auto flex min-h-screen flex-col items-center justify-center p-4">
	{#if showResumePrompt}
		<!-- Resume Prompt Card -->
		<div class="card bg-base-100 mx-auto w-full max-w-md shadow-xl">
			<div class="card-body items-center text-center">
				<h2 class="card-title">Resume Quiz?</h2>
				<p>
					It looks like you have a quiz in progress. Would you like to continue where you left off?
				</p>
				<div class="card-actions mt-4 justify-center space-x-4">
					<button class="btn btn-primary" on:click={resumeQuiz}>Yes, Resume</button>
					<button class="btn btn-ghost" on:click={startNewQuiz}>No, Start Over</button>
				</div>
			</div>
		</div>
	{:else if $quizPhase === 'start'}
		<!-- Start Screen Card -->
		<div class="card bg-base-100 w-full max-w-md shadow-xl">
			<div class="card-body items-center text-center">
				<h1 class="card-title mb-4 text-3xl">Find Your Top 5 Professional Values</h1>
				<p class="mb-6">
					Answer a series of questions to discover the values that matter most to you in your work
					life.
				</p>
				<button class="btn btn-primary btn-lg" on:click={startQuiz}> Start Quiz </button>
			</div>
		</div>
	{:else if $quizPhase === 'phase1' || $quizPhase === 'phase2'}
		<!-- Progress Bar -->
		<ProgressBar
			current={$currentQuestionIndex}
			total={TOTAL_QUESTIONS}
			phase={$quizPhase === 'phase1'
				? `Phase 1 (${TOTAL_PHASE_1_QUESTIONS} questions)`
				: `Phase 2 (${TOTAL_PHASE_2_QUESTIONS} questions)`}
		/>

		<!-- Loading Indicator -->
		{#if isLoading}
			<div class="my-10 text-center">
				<span class="loading loading-lg loading-spinner text-primary"></span>
				{#if $quizPhase === 'phase2'}
					<p>Generating next question...</p>
				{/if}
			</div>
		{/if}

		<!-- Error Message & Retry Button -->
		{#if $errorMessage && !isLoading}
			<div role="alert" class="alert alert-error mx-auto my-4 max-w-xl">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-6 w-6 shrink-0 stroke-current"
					fill="none"
					viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
					/></svg
				>
				<span>Error: {$errorMessage}</span>
				{#if $retryPossible}
					<button class="btn btn-sm btn-primary" on:click={retryFetchQuestion}> Retry </button>
				{:else}
					<!-- Show restart only for non-retryable errors (like initial load failure) -->
					<button class="btn btn-sm btn-ghost" on:click={resetQuiz}>Restart Quiz</button>
				{/if}
			</div>
		{/if}

		<!-- Question Card -->
		<!-- Only show question if not loading AND no error is pending retry -->
		{#if currentQuestion && !isLoading && !$errorMessage}
			<QuestionCard question={currentQuestion} onAnswer={handleAnswer} />
		{/if}
	{:else if $quizPhase === 'results'}
		<!-- Results Display -->
		<ResultsDisplay finalScores={$valueScores} />
	{:else if $quizPhase === 'error' && !isLoading}
		<!-- General Error Display (for critical non-retryable errors like initial load) -->
		<div role="alert" class="alert alert-error mx-auto max-w-xl">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-6 w-6 shrink-0 stroke-current"
				fill="none"
				viewBox="0 0 24 24"
				><path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
				/></svg
			>
			<span
				>An unexpected error occurred: {$errorMessage || 'Unknown error'}. Please try restarting.</span
			>
			<button class="btn btn-sm btn-primary" on:click={resetQuiz}>Restart Quiz</button>
		</div>
	{/if}
</main>
