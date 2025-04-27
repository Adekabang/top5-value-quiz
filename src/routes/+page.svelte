<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	// *** Import reviewText store ***
	import {
		quizPhase,
		valueScores,
		currentQuestionIndex,
		currentPhase2Question,
		errorMessage,
		retryPossible,
		resetQuiz,
		clearLocalStorage,
		quizHistory,
		evaluatedTop5,
		reviewText // <-- Import new store
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
		QuizQuestion,
		QuizPhase,
		AnswerRecord,
		EvaluateAnswersResponse,
		ReviewResponse // <-- Import type
	} from '$lib/types';
	import QuestionCard from '$lib/components/QuestionCard.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import ResultsDisplay from '$lib/components/ResultsDisplay.svelte';
	import ValueCarousel from '$lib/components/ValueCarousel.svelte';

	let phase1Questions: Phase1Question[] = [];
	let currentQuestion: QuizQuestion | null = null;
	let isLoading = false;
	let loadingMessage = ''; // More specific loading message
	let showResumePrompt = false;

	// Type guards remain the same...
	function isPhase1(phase: QuizPhase): phase is 'phase1' {
		return phase === 'phase1';
	}
	function isPhase2(phase: QuizPhase): phase is 'phase2' {
		return phase === 'phase2';
	}
	function isEvaluating(phase: QuizPhase): phase is 'evaluating' {
		return phase === 'evaluating';
	}
	function isPhase(phase: QuizPhase, currentPhase: QuizPhase): boolean {
		return currentPhase === phase;
	}

	// onMount, resumeQuiz, startNewQuiz, startQuiz, setCurrentQuestion remain the same...
	onMount(async () => {
		try {
			const response = await fetch('/phase1_questions.json');
			if (!response.ok) throw new Error('Failed to load Phase 1 questions');
			phase1Questions = await response.json();

			// Resume logic needs to check if evaluation/review is pending
			if (browser && localStorage.getItem('valueScores') && $currentQuestionIndex > 0) {
				// If results exist (evaluation+review done), go to results
				// Check quizPhase store directly as evaluatedTop5/reviewText aren't persisted
				if (isPhase('results', $quizPhase)) {
					// Already done, stay in results (or potentially re-evaluate if desired)
					// For simplicity, we assume results phase means done.
				}
				// If evaluation done but review pending/failed
				else if (isPhase('evaluating', $quizPhase)) {
					// Let determinePhaseAndQuestion handle triggering the right step
					determinePhaseAndQuestion();
				}
				// If mid-quiz
				else if (
					$currentQuestionIndex <= TOTAL_QUESTIONS &&
					!isPhase('results', $quizPhase) &&
					!isPhase('evaluating', $quizPhase)
				) {
					showResumePrompt = true;
				}
				// Otherwise, likely inconsistent state, reset
				else {
					console.warn('Inconsistent state on load, resetting quiz.');
					resetQuiz();
					quizPhase.set('start');
				}
			} else if ($currentQuestionIndex === 0) {
				clearLocalStorage();
				quizPhase.set('start');
			}
		} catch (err: any) {
			console.error('Error loading Phase 1 questions:', err);
			errorMessage.set(`Error loading initial data: ${err.message}`);
			quizPhase.set('error');
			retryPossible.set(false);
		}
	});

	function resumeQuiz() {
		showResumePrompt = false;
		// Determine the correct phase based on the current question index
		if ($currentQuestionIndex <= TOTAL_PHASE_1_QUESTIONS) {
			quizPhase.set('phase1');
		} else if ($currentQuestionIndex <= TOTAL_QUESTIONS) {
			quizPhase.set('phase2');
		}
		// Now let determinePhaseAndQuestion handle loading the correct question
		determinePhaseAndQuestion();
	}
	function startNewQuiz() {
		showResumePrompt = false;
		resetQuiz();
		quizPhase.set('start');
	}
	function startQuiz() {
		resetQuiz();
		quizPhase.set('phase1');
		currentQuestionIndex.set(1);
		setCurrentQuestion();
	}
	function setCurrentQuestion() {
		const index = $currentQuestionIndex;
		if ($quizPhase === 'phase1' && index > 0 && index <= TOTAL_PHASE_1_QUESTIONS) {
			// When setting a phase1 question, make sure we load the correct one (index-1 since array is 0-based)
			currentQuestion = phase1Questions[index - 1];
			console.log('Setting Phase 1 question:', index, currentQuestion);
		} else if ($quizPhase === 'phase2' && $currentPhase2Question) {
			currentQuestion = $currentPhase2Question;
			console.log('Setting Phase 2 question:', index, currentQuestion);
		} else if ($quizPhase === 'phase2' && !$currentPhase2Question && !isLoading) {
			// If we're in phase2 but don't have a question yet, trigger fetch
			console.log('No Phase 2 question available, triggering fetch');
			fetchNextPhase2Question();
		} else {
			console.log('Unable to set current question. Phase:', $quizPhase, 'Index:', index);
			currentQuestion = null;
		}
	}
	async function fetchNextPhase2Question() {
		if ($quizPhase !== 'phase2') return;

		isLoading = true;
		loadingMessage = 'Generating next question...';
		errorMessage.set(null);
		retryPossible.set(false);

		const remaining = TOTAL_QUESTIONS - $currentQuestionIndex + 1;

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
			if (!response.ok) {
				let errorMsg = `API Error (${response.status})`;
				try {
					const errorData = await response.json();
					errorMsg = errorData.message || errorMsg;
				} catch (e) {
					errorMsg = `${errorMsg}: ${response.statusText}`;
				}
				const error: any = new Error(errorMsg);
				error.status = response.status;
				throw error;
			}

			const nextQuestion: Phase2Question = await response.json();
			currentPhase2Question.set(nextQuestion);
			setCurrentQuestion();
		} catch (err: any) {
			/* ... error handling ... */
			console.error('Error fetching Phase 2 question:', err);
			if (err.status === 429) {
				errorMessage.set('Rate limit reached. Please wait a moment and try again.');
			} else {
				errorMessage.set(`Failed to get next question: ${err.message || 'Unknown error'}`);
			}
			retryPossible.set(true);
		} finally {
			isLoading = false;
			loadingMessage = '';
		}
	}
	function retryFetchQuestion() {
		console.log('Retrying fetchNextPhase2Question...');
		fetchNextPhase2Question();
	}

	// --- Updated evaluateAnswers ---
	async function evaluateAnswers() {
		console.log('Starting AI evaluation...');
		isLoading = true;
		loadingMessage = 'Analyzing your answers...'; // Set loading message
		errorMessage.set(null);
		retryPossible.set(false);

		try {
			const response = await fetch('/api/evaluate-answers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					history: $quizHistory,
					finalScores: $valueScores // Send scores for context
				})
			});
			if (!response.ok) {
				let errorMsg = `Evaluation API Error (${response.status})`;
				try {
					const errorData = await response.json();
					errorMsg = errorData.message || errorMsg;
				} catch (e) {
					errorMsg = `${errorMsg}: ${response.statusText}`;
				}
				const error: any = new Error(errorMsg);
				error.status = response.status;
				throw error;
			}

			const result: EvaluateAnswersResponse = await response.json();
			if (!result.top5Values || result.top5Values.length !== 5) {
				throw new Error('Invalid evaluation data received from server.');
			}

			evaluatedTop5.set(result.top5Values); // Store the AI's top 5

			// *** SUCCESS: Now trigger review generation ***
			// Don't set isLoading to false here, let generateReviewText handle it
			await generateReviewText();
		} catch (err: any) {
			console.error('Error evaluating answers:', err);
			if (err.status === 429) {
				errorMessage.set('Rate limit reached during analysis. Please wait and try again.');
			} else {
				errorMessage.set(`Failed to analyze results: ${err.message || 'Unknown error'}`);
			}
			retryPossible.set(true); // Allow retry for evaluation
			isLoading = false; // Stop loading indicator on evaluation error
			loadingMessage = '';
		}
	}

	// *** NEW: Function to generate the review text ***
	async function generateReviewText() {
		// Ensure evaluatedTop5 is set before proceeding
		if (!$evaluatedTop5) {
			console.error('Cannot generate review without evaluated top 5 values.');
			errorMessage.set('Analysis must complete before generating insights.');
			retryPossible.set(true); // Allow retry of the evaluation step
			isLoading = false;
			loadingMessage = '';
			return;
		}

		console.log('Generating results review...');
		isLoading = true; // Keep loading active
		loadingMessage = 'Generating insights...'; // Update loading message
		errorMessage.set(null); // Clear previous errors
		retryPossible.set(false); // Reset retry for this specific step

		try {
			const response = await fetch('/api/generate-review', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					history: $quizHistory,
					finalScores: $valueScores
				})
			});

			if (!response.ok) {
				let errorMsg = `Review API Error (${response.status})`;
				try {
					const errorData = await response.json();
					errorMsg = errorData.message || errorMsg;
				} catch (e) {
					errorMsg = `${errorMsg}: ${response.statusText}`;
				}
				const error: any = new Error(errorMsg);
				error.status = response.status;
				throw error;
			}

			const result: ReviewResponse = await response.json();

			if (!result.reviewText) {
				throw new Error('Invalid review data received from server.');
			}

			reviewText.set(result.reviewText); // Store the review
			quizPhase.set('results'); // **** Move to results ONLY after review success ****
		} catch (err: any) {
			console.error('Error generating review:', err);
			if (err.status === 429) {
				errorMessage.set('Rate limit reached generating review. Please wait and try again.');
			} else {
				errorMessage.set(`Failed to generate review: ${err.message || 'Unknown error'}`);
			}
			retryPossible.set(true); // Allow retry for review generation
			// Stay in 'evaluating' phase on error
		} finally {
			isLoading = false; // Stop loading indicator
			loadingMessage = ''; // Clear loading message
		}
	}

	// *** Updated retryEvaluation to retry the whole process ***
	function retryEvaluation() {
		console.log('Retrying evaluation and review...');
		// Simply call evaluateAnswers again, it will handle both steps
		evaluateAnswers();
	}
	// *** NEW: Function to specifically retry review generation ***
	function retryReview() {
		console.log('Retrying review generation...');
		generateReviewText(); // Call only the review step
	}

	// --- Updated handleAnswer ---
	function handleAnswer(selectedOption: Phase1Option | Phase2Option | Phase2Option[]) {
		if (!currentQuestion || isLoading || $retryPossible) return;

		// --- Apply Scoring Logic (remains same) ---
		let updatedScores = { ...$valueScores };
		if (currentQuestion.type === 'simple_choice' && 'value_area_hint' in selectedOption) {
			(selectedOption as Phase1Option).value_area_hint.forEach((value) => {
				if (updatedScores.hasOwnProperty(value)) updatedScores[value]++;
			});
		} else if (currentQuestion.type === 'forced_choice' && 'text' in selectedOption) {
			const chosenValueText = (selectedOption as Phase2Option).text;
			const comparedValues = (currentQuestion as Phase2Question).values_being_compared;
			const chosenValue = comparedValues.find((v) => chosenValueText.includes(v));
			const otherValue = comparedValues.find((v) => v !== chosenValue);
			if (chosenValue && updatedScores.hasOwnProperty(chosenValue)) updatedScores[chosenValue] += 2;
			if (otherValue && updatedScores.hasOwnProperty(otherValue)) updatedScores[otherValue] -= 1;
		} else if (currentQuestion.type === 'ranking' && Array.isArray(selectedOption)) {
			const rankedOptions = selectedOption as Phase2Option[];
			const comparedValues = (currentQuestion as Phase2Question).values_being_compared;
			rankedOptions.forEach((option, index) => {
				const rank = index + 1;
				const points = Math.max(0, 4 - rank);
				const value = comparedValues.find((v) => option.text.includes(v));
				if (value && updatedScores.hasOwnProperty(value)) updatedScores[value] += points;
			});
		}
		valueScores.set(updatedScores);

		// --- Record Answer in History ---
		let answerText: string | string[];
		let valuesInvolved: string[] = [];
		if (currentQuestion.type === 'simple_choice' && 'value_area_hint' in selectedOption) {
			answerText = selectedOption.text;
			valuesInvolved = selectedOption.value_area_hint;
		} else if (currentQuestion.type === 'forced_choice' && 'text' in selectedOption) {
			answerText = selectedOption.text;
			valuesInvolved = (currentQuestion as Phase2Question).values_being_compared;
		} else if (currentQuestion.type === 'ranking' && Array.isArray(selectedOption)) {
			answerText = selectedOption.map((opt) => opt.text);
			valuesInvolved = (currentQuestion as Phase2Question).values_being_compared;
		} else {
			answerText = 'Unknown';
		}

		const record: AnswerRecord = {
			questionId: currentQuestion.id,
			questionText: currentQuestion.text,
			questionType: currentQuestion.type,
			answer: answerText,
			valuesInvolved: valuesInvolved,
			timestamp: Date.now()
		};
		quizHistory.update((history) => [...history, record]);

		// --- Advance Quiz ---
		const nextIndex = $currentQuestionIndex + 1;

		if (nextIndex <= TOTAL_PHASE_1_QUESTIONS) {
			currentQuestionIndex.set(nextIndex);
			quizPhase.set('phase1');
			setCurrentQuestion();
		} else if (nextIndex <= TOTAL_QUESTIONS) {
			currentQuestionIndex.set(nextIndex);
			quizPhase.set('phase2');
			currentPhase2Question.set(null); // Signal fetch needed via reactive statement
		} else {
			// *** Quiz finished - Move to EVALUATING phase ***
			quizPhase.set('evaluating');
			currentQuestionIndex.set(nextIndex); // Mark as completed index-wise
			currentQuestion = null;
			currentPhase2Question.set(null);
			// Evaluation/Review triggered by determinePhaseAndQuestion
		}
	}

	// --- Updated Reactive statement ---
	$: if (browser && !showResumePrompt) {
		determinePhaseAndQuestion($quizPhase, $currentQuestionIndex);
	}

	// --- Updated determinePhaseAndQuestion ---
	function determinePhaseAndQuestion(phase: QuizPhase = $quizPhase, index = $currentQuestionIndex) {
		// Only reset error if not loading AND not already in an error state needing retry
		if (!isLoading && !$retryPossible) {
			errorMessage.set(null);
		}

		switch (phase) {
			case 'start':
			case 'results':
			case 'error':
				currentQuestion = null;
				return;
			case 'evaluating':
				currentQuestion = null;
				if (!isLoading && !$retryPossible) {
					if ($evaluatedTop5 && !$reviewText) {
						console.log('State: Evaluating - Top 5 found, review missing. Triggering review.');
						generateReviewText();
					} else if (!$evaluatedTop5) {
						console.log('State: Evaluating - Top 5 missing. Triggering evaluation.');
						evaluateAnswers();
					} else {
						console.log('State: Evaluating - Both top 5 and review exist. Moving to results.');
						quizPhase.set('results');
					}
				}
				return;
			case 'phase1':
				if (index > 0 && index <= TOTAL_PHASE_1_QUESTIONS && phase1Questions.length > 0) {
					currentQuestion = phase1Questions[index - 1];
					// Make sure we're in phase1
					quizPhase.set('phase1');
				} else {
					currentQuestion = null;
				}
				return;
			case 'phase2':
				if (index > TOTAL_PHASE_1_QUESTIONS && index <= TOTAL_QUESTIONS) {
					// Make sure we're in phase2
					quizPhase.set('phase2');
					if (!$currentPhase2Question && !isLoading && !$retryPossible) {
						fetchNextPhase2Question();
					} else if ($currentPhase2Question) {
						currentQuestion = $currentPhase2Question;
					}
				} else {
					currentQuestion = null;
				}
				return;
			default:
				console.warn('State: Unknown phase detected, resetting to start.');
				currentQuestion = null;
				quizPhase.set('start');
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
				<!-- Add the carousel -->
				<div class="mb-6 w-full">
					<ValueCarousel />
				</div>
				<p class="mb-6">
					Answer a series of questions to discover the values that matter most to you in your work
					life.
				</p>
				<button class="btn btn-primary btn-lg" on:click={startQuiz}> Start Quiz </button>
			</div>
		</div>
	{:else if isPhase1($quizPhase) || isPhase2($quizPhase)}
		<!-- Progress Bar -->
		<ProgressBar
			current={$currentQuestionIndex}
			total={TOTAL_QUESTIONS}
			phase={isPhase1($quizPhase)
				? `Phase 1 (${TOTAL_PHASE_1_QUESTIONS} questions)`
				: `Phase 2 (${TOTAL_PHASE_2_QUESTIONS} questions)`}
		/>

		<!-- Loading Indicator -->
		{#if isLoading}
			<div class="my-10 text-center">
				<span class="loading loading-lg loading-spinner text-primary"></span>
				{#if isPhase2($quizPhase)}
					<p>{loadingMessage || 'Generating next question...'}</p>
				{/if}
			</div>
		{/if}

		<!-- Error Message & Retry Button -->
		{#if $errorMessage && !isLoading}
			<div role="alert" class="alert alert-error mx-auto my-4 max-w-xl">
				<!-- Error Icon -->
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
					<!-- Only show retry for question generation here -->
					<button class="btn btn-sm btn-primary" on:click={retryFetchQuestion}> Retry </button>
				{:else}
					<button class="btn btn-sm btn-ghost" on:click={resetQuiz}>Restart Quiz</button>
				{/if}
			</div>
		{/if}

		<!-- Question Card -->
		{#if currentQuestion && !isLoading && !$errorMessage}
			<QuestionCard question={currentQuestion} onAnswer={handleAnswer} />
		{/if}
	{:else if isEvaluating($quizPhase)}
		<!-- Evaluating Phase UI -->
		<ProgressBar current={TOTAL_QUESTIONS} total={TOTAL_QUESTIONS} phase="Evaluating" />
		{#if isLoading}
			<div class="my-10 text-center">
				<span class="loading loading-lg loading-spinner text-primary"></span>
				<!-- Show specific loading message -->
				<p>{loadingMessage || 'Processing...'}</p>
			</div>
		{/if}
		<!-- Error Message & Retry Button for Evaluation/Review -->
		{#if $errorMessage && !isLoading}
			<div role="alert" class="alert alert-error mx-auto my-4 max-w-xl">
				<!-- Error Icon -->
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
					<!-- Determine which retry button to show -->
					{#if $evaluatedTop5 && !$reviewText}
						<!-- If evaluation succeeded, error must be in review -->
						<button class="btn btn-sm btn-primary" on:click={retryReview}> Retry Insights </button>
					{:else}
						<!-- Otherwise, error was in evaluation -->
						<button class="btn btn-sm btn-primary" on:click={retryEvaluation}>
							Retry Analysis
						</button>
					{/if}
				{:else}
					<button class="btn btn-sm btn-ghost" on:click={resetQuiz}>Restart Quiz</button>
				{/if}
			</div>
		{/if}
	{:else if $quizPhase === 'results'}
		<!-- Results Display - Pass evaluated results AND review text -->
		<ResultsDisplay
			topValuesResult={$evaluatedTop5}
			finalScores={$valueScores}
			reviewText={$reviewText}
		/>
	{:else if $quizPhase === 'error' && !isLoading}
		<!-- General Error Display -->
		<div role="alert" class="alert alert-error mx-auto max-w-xl">
			<!-- Error Icon -->
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-6 w-6 shrink-0 stroke-current"
				fill="none"
				viewBox="0 24 24"
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
