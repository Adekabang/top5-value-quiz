<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	// *** Import new stores and types ***
	import {
		quizPhase,
		valueScores,
		currentQuestionIndex,
		currentPhase2Question,
		errorMessage,
		retryPossible,
		resetQuiz,
		clearLocalStorage,
		quizHistory, // Import history store
		evaluatedTop5 // Import evaluated results store
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
		AnswerRecord, // Import AnswerRecord type
		EvaluateAnswersResponse // Import response type
	} from '$lib/types';
	import QuestionCard from '$lib/components/QuestionCard.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import ResultsDisplay from '$lib/components/ResultsDisplay.svelte';

	let phase1Questions: Phase1Question[] = [];
	let currentQuestion: QuizQuestion | null = null;
	let isLoading = false;
	let showResumePrompt = false;

	// Add type guard functions
	function isPhase1(phase: string): phase is 'phase1' {
		return phase === 'phase1';
	}

	function isPhase2(phase: string): phase is 'phase2' {
		return phase === 'phase2';
	}

	function isEvaluating(phase: string): phase is 'evaluating' {
		return phase === 'evaluating';
	}

	// onMount, resumeQuiz, startNewQuiz, startQuiz, setCurrentQuestion remain the same...
	onMount(async () => {
		try {
			const response = await fetch('/phase1_questions.json');
			if (!response.ok) throw new Error('Failed to load Phase 1 questions');
			phase1Questions = await response.json();

			if (
				browser &&
				localStorage.getItem('valueScores') &&
				$currentQuestionIndex > 0 &&
				$currentQuestionIndex < TOTAL_QUESTIONS // Check if *before* evaluation phase
			) {
				showResumePrompt = true;
			} else if ($currentQuestionIndex === 0) {
				clearLocalStorage();
				quizPhase.set('start');
			} else {
				// If index is >= TOTAL_QUESTIONS, it might be finished or evaluating
				// Let determinePhaseAndQuestion handle the state based on quizPhase store
				determinePhaseAndQuestion();
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
			currentQuestion = phase1Questions[index - 1];
		} else if ($quizPhase === 'phase2' && $currentPhase2Question) {
			currentQuestion = $currentPhase2Question;
		} else {
			currentQuestion = null;
		}
	}

	// fetchNextPhase2Question remains the same...
	async function fetchNextPhase2Question() {
		if ($quizPhase !== 'phase2') return;

		isLoading = true;
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
			console.error('Error fetching Phase 2 question:', err);
			if (err.status === 429) {
				errorMessage.set('Rate limit reached. Please wait a moment and try again.');
			} else {
				errorMessage.set(`Failed to get next question: ${err.message || 'Unknown error'}`);
			}
			retryPossible.set(true);
		} finally {
			isLoading = false;
		}
	}

	// retryFetchQuestion remains the same...
	function retryFetchQuestion() {
		console.log('Retrying fetchNextPhase2Question...');
		fetchNextPhase2Question();
	}

	// *** NEW: Function to call the evaluation API ***
	async function evaluateAnswers() {
		console.log('Starting final evaluation...');
		isLoading = true;
		errorMessage.set(null);
		retryPossible.set(false); // Reset retry state for evaluation

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

			evaluatedTop5.set(result.top5Values); // Store the AI's result
			quizPhase.set('results'); // Move to results phase
		} catch (err: any) {
			console.error('Error evaluating answers:', err);
			if (err.status === 429) {
				errorMessage.set('Rate limit reached during evaluation. Please wait and try again.');
			} else {
				errorMessage.set(`Failed to evaluate results: ${err.message || 'Unknown error'}`);
			}
			// Allow retry for evaluation errors too
			retryPossible.set(true);
			// Stay in 'evaluating' phase on error to show retry button
		} finally {
			isLoading = false;
		}
	}

	// *** NEW: Function to handle retry for evaluation ***
	function retryEvaluation() {
		console.log('Retrying evaluation...');
		evaluateAnswers();
	}

	// --- Updated handleAnswer ---
	function handleAnswer(selectedOption: Phase1Option | Phase2Option | Phase2Option[]) {
		if (!currentQuestion || isLoading || $retryPossible) return;

		// --- Apply Scoring Logic (remains same) ---
		let updatedScores = { ...$valueScores };
		// ... scoring logic ...
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
			answerText = selectedOption.map((opt) => opt.text); // Store ranked list of texts
			valuesInvolved = (currentQuestion as Phase2Question).values_being_compared;
		} else {
			answerText = 'Unknown'; // Fallback
		}

		const record: AnswerRecord = {
			questionId: currentQuestion.id,
			questionText: currentQuestion.text,
			questionType: currentQuestion.type,
			answer: answerText,
			valuesInvolved: valuesInvolved,
			timestamp: Date.now()
		};
		quizHistory.update((history) => [...history, record]); // Add record to history store

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
		}
	}

	// --- Updated Reactive statement ---
	$: if (browser && !showResumePrompt) {
		determinePhaseAndQuestion($quizPhase, $currentQuestionIndex);
	}

	// --- Updated determinePhaseAndQuestion ---
	function determinePhaseAndQuestion(
		phase:
			| 'start'
			| 'phase1'
			| 'phase2'
			| 'evaluating'
			| 'results'
			| 'loading'
			| 'error' = $quizPhase,
		index = $currentQuestionIndex
	) {
		if (!isLoading) {
			errorMessage.set(null);
			retryPossible.set(false);
		}

		// Handle special phases first
		switch (phase) {
			case 'start':
			case 'results':
			case 'error':
				currentQuestion = null;
				return;
			case 'evaluating':
				currentQuestion = null; // No question displayed during evaluation
				if (!isLoading && !$errorMessage) {
					evaluateAnswers();
				}
				return;
			case 'phase1':
				if (index > 0 && index <= TOTAL_PHASE_1_QUESTIONS && phase1Questions.length > 0) {
					currentQuestion = phase1Questions[index - 1];
				}
				return;
			case 'phase2':
				if (index > TOTAL_PHASE_1_QUESTIONS && index <= TOTAL_QUESTIONS) {
					if (!$currentPhase2Question && !isLoading) {
						fetchNextPhase2Question();
					} else if ($currentPhase2Question) {
						currentQuestion = $currentPhase2Question;
					}
				}
				return;
			default:
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
					<p>Generating next question...</p>
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
					<!-- Use specific retry function based on phase -->
					{#if isPhase2($quizPhase)}
						<button class="btn btn-sm btn-primary" on:click={retryFetchQuestion}> Retry </button>
					{:else if isEvaluating($quizPhase)}
						<button class="btn btn-sm btn-primary" on:click={retryEvaluation}>
							Retry Evaluation
						</button>
					{/if}
				{:else}
					<button class="btn btn-sm btn-ghost" on:click={resetQuiz}>Restart Quiz</button>
				{/if}
			</div>
		{/if}

		<!-- Question Card -->
		{#if currentQuestion && !isLoading && !$errorMessage}
			<QuestionCard question={currentQuestion} onAnswer={handleAnswer} />
		{/if}

		<!-- *** NEW: Evaluating Phase UI *** -->
	{:else if isEvaluating($quizPhase)}
		<!-- Progress Bar (Optional: Show progress at 100% or hide) -->
		<ProgressBar current={TOTAL_QUESTIONS} total={TOTAL_QUESTIONS} phase="Evaluating" />
		<!-- Loading/Evaluating Indicator -->
		{#if isLoading}
			<div class="my-10 text-center">
				<span class="loading loading-lg loading-spinner text-primary"></span>
				<p>Analyzing your answers...</p>
			</div>
		{/if}
		<!-- Error Message & Retry Button for Evaluation -->
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
					<button class="btn btn-sm btn-primary" on:click={retryEvaluation}>
						Retry Evaluation
					</button>
				{:else}
					<button class="btn btn-sm btn-ghost" on:click={resetQuiz}>Restart Quiz</button>
				{/if}
			</div>
		{/if}
	{:else if $quizPhase === 'results'}
		<!-- Results Display - Pass the evaluated results -->
		<ResultsDisplay topValuesResult={$evaluatedTop5} finalScores={$valueScores} />
	{:else if $quizPhase === 'error' && !isLoading}
		<!-- General Error Display -->
		<div role="alert" class="alert alert-error mx-auto max-w-xl">
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
			<span
				>An unexpected error occurred: {$errorMessage || 'Unknown error'}. Please try restarting.</span
			>
			<button class="btn btn-sm btn-primary" on:click={resetQuiz}>Restart Quiz</button>
		</div>
	{/if}
</main>
