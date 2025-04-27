import { writable } from 'svelte/store';
// *** Import new types ***
import type { ValueScores, QuizPhase, Phase2Question, AnswerRecord } from './types';
import { PROFESSIONAL_VALUES } from './constants';
import { browser } from '$app/environment';

// Function to initialize scores with all values at 0
const initializeScores = (): ValueScores => {
	const scores: ValueScores = {};
	PROFESSIONAL_VALUES.forEach((value) => {
		scores[value] = 0;
	});
	return scores;
};

// --- Store Definitions ---

// Current phase of the quiz - now with localStorage persistence
const storedPhase = browser ? localStorage.getItem('quizPhase') : null;
const initialPhase = storedPhase || 'start';
export const quizPhase = writable<
	'start' | 'phase1' | 'phase2' | 'evaluating' | 'results' | 'loading' | 'error'
>(initialPhase as any);

if (browser) {
	quizPhase.subscribe((phase) => {
		localStorage.setItem('quizPhase', phase);
	});
}

// Scores for each professional value
const storedScores = browser ? localStorage.getItem('valueScores') : null;
const initialScores = storedScores ? JSON.parse(storedScores) : initializeScores();
export const valueScores = writable<ValueScores>(initialScores);

if (browser) {
	valueScores.subscribe((scores) => {
		localStorage.setItem('valueScores', JSON.stringify(scores));
	});
}

// Current question number (overall progress)
const storedCurrentQuestionIndex = browser ? localStorage.getItem('currentQuestionIndex') : null;
const initialCurrentQuestionIndex = storedCurrentQuestionIndex
	? parseInt(storedCurrentQuestionIndex, 10)
	: 0;
export const currentQuestionIndex = writable<number>(initialCurrentQuestionIndex);

if (browser) {
	currentQuestionIndex.subscribe((index) => {
		localStorage.setItem('currentQuestionIndex', index.toString());
	});
}

// Store the current Phase 2 question (fetched from AI)
export const currentPhase2Question = writable<Phase2Question | null>(null);

// Store error messages
export const errorMessage = writable<string | null>(null);

// Store to indicate if a retry is possible for the current error
export const retryPossible = writable<boolean>(false);

// *** NEW: Store for the quiz answer history ***
const storedHistory = browser ? localStorage.getItem('quizHistory') : null;
const initialHistory = storedHistory ? JSON.parse(storedHistory) : [];
export const quizHistory = writable<AnswerRecord[]>(initialHistory);

if (browser) {
	quizHistory.subscribe((history) => {
		localStorage.setItem('quizHistory', JSON.stringify(history));
	});
}

// *** NEW: Store for the final AI-evaluated results ***
// Do not persist this, calculate fresh each time
export const evaluatedTop5 = writable<string[] | null>(null);

// *** NEW: Store for the AI-generated review text ***
// Do not persist this, calculate fresh each time
export const reviewText = writable<string | null>(null);

// --- Helper Functions ---

// Function to reset the quiz state
export function resetQuiz() {
	quizPhase.set('start');
	valueScores.set(initializeScores());
	currentQuestionIndex.set(0);
	currentPhase2Question.set(null);
	errorMessage.set(null);
	retryPossible.set(false);
	quizHistory.set([]); // Clear history store
	evaluatedTop5.set(null); // Clear evaluated results store
	reviewText.set(null); // Reset review text
	clearLocalStorage(); // Clear storage on explicit reset
}

// Function to safely clear localStorage on explicit reset
export function clearLocalStorage() {
	if (browser) {
		localStorage.removeItem('valueScores');
		localStorage.removeItem('currentQuestionIndex');
		localStorage.removeItem('quizHistory'); // Remove history from storage
		localStorage.removeItem('quizPhase'); // Remove phase from storage
	}
}
