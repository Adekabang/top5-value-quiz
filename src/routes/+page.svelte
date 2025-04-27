<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import {
		quizPhase,
		valueScores,
		currentQuestionIndex,
		currentPhase2Question,
		errorMessage,
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
	let isLoading = false; // For loading state during API calls
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
			quizPhase.set('error');
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
		currentPhase2Question.set(null); // Clear previous question

		const remaining = TOTAL_QUESTIONS - $currentQuestionIndex + 1;

		try {
			const response = await fetch('/api/generate-question', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					scores: $valueScores,
					valuesList: PROFESSIONAL_VALUES,
					remainingQuestions: remaining
					// history: [] // Optional: Add history if needed by prompt
				})
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`API Error (${response.status}): ${errorText}`);
			}

			const nextQuestion: Phase2Question = await response.json();
			currentPhase2Question.set(nextQuestion);
			setCurrentQuestion(); // Update the displayed question
		} catch (err: any) {
			console.error('Error fetching Phase 2 question:', err);
			errorMessage.set(`Failed to get next question: ${err.message}`);
			quizPhase.set('error');
		} finally {
			isLoading = false;
		}
	}

	// Handle user answering a question
	function handleAnswer(selectedOption: Phase1Option | Phase2Option | Phase2Option[]) {
		if (!currentQuestion) return;

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
			// Find which value corresponds to the chosen text (might need refinement if text != value)
			// Assuming option text directly relates or IS the value for now
			const chosenValue = comparedValues.find((v) => chosenValueText.includes(v)); // Simple check
			const otherValue = comparedValues.find((v) => v !== chosenValue);

			if (chosenValue && updatedScores.hasOwnProperty(chosenValue)) {
				updatedScores[chosenValue] += 2;
			}
			if (otherValue && updatedScores.hasOwnProperty(otherValue)) {
				updatedScores[otherValue] -= 1; // Penalty for not chosen
			}
			// Ensure scores don't go below zero (optional rule)
			// if (updatedScores[otherValue] < 0) updatedScores[otherValue] = 0;
		} else if (currentQuestion.type === 'ranking' && Array.isArray(selectedOption)) {
			// Phase 2 Ranking Scoring
			const rankedOptions = selectedOption as Phase2Option[];
			const comparedValues = (currentQuestion as Phase2Question).values_being_compared;

			rankedOptions.forEach((option, index) => {
				const rank = index + 1; // 1-based rank
				const points = Math.max(0, 4 - rank); // Rank 1: +3, Rank 2: +2, Rank 3: +1, Rank 4: 0

				// Find the value corresponding to the option text
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
			fetchNextPhase2Question(); // Fetch the next AI question
		} else {
			// Quiz finished
			quizPhase.set('results');
			currentQuestionIndex.set(nextIndex); // Mark as completed
			currentQuestion = null;
		}
	}

	// Reactive statement to determine phase and load question if phase changes externally (like from resume)
	$: if (browser && !showResumePrompt) {
		// Only run in browser and when not showing resume prompt
		determinePhaseAndQuestion($quizPhase, $currentQuestionIndex);
	}

	function determinePhaseAndQuestion(phase = $quizPhase, index = $currentQuestionIndex) {
		if (phase === 'start' || phase === 'results' || phase === 'error' || phase === 'loading') {
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
			// Fetch question if not already loaded or if index changed
			if (
				!$currentPhase2Question ||
				($currentPhase2Question && $currentPhase2Question.id !== `q${index}`)
			) {
				// Basic check, might need better ID logic
				fetchNextPhase2Question();
			} else {
				currentQuestion = $currentPhase2Question; // Already have the correct question
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
				<p>Generating next question...</p>
			</div>
		{/if}

		<!-- Error Message -->
		{#if $errorMessage && !isLoading}
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
				<span>Error: {$errorMessage}</span>
				<button class="btn btn-sm btn-ghost" on:click={resetQuiz}>Restart</button>
			</div>
		{/if}

		<!-- Question Card -->
		{#if currentQuestion && !isLoading && !$errorMessage}
			<QuestionCard question={currentQuestion} onAnswer={handleAnswer} />
		{/if}
	{:else if $quizPhase === 'results'}
		<ResultsDisplay finalScores={$valueScores} />
	{:else if $quizPhase === 'error' && !isLoading}
		<!-- General Error Display (if not handled above) -->
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
