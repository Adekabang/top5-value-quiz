import { writable } from 'svelte/store';
import type { ValueScores, QuizPhase, Phase2Question } from './types';
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

// Current phase of the quiz
export const quizPhase = writable<QuizPhase>('start');

// Scores for each professional value
// Attempt to load from localStorage if in browser
const storedScores = browser ? localStorage.getItem('valueScores') : null;
const initialScores = storedScores ? JSON.parse(storedScores) : initializeScores();
export const valueScores = writable<ValueScores>(initialScores);

// Subscribe to score changes and save to localStorage
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

// --- Helper Functions ---

// Function to reset the quiz state
export function resetQuiz() {
	quizPhase.set('start');
	valueScores.set(initializeScores());
	currentQuestionIndex.set(0);
	currentPhase2Question.set(null);
	errorMessage.set(null);
	if (browser) {
		localStorage.removeItem('valueScores');
		localStorage.removeItem('currentQuestionIndex');
	}
}

// Function to safely clear localStorage on explicit reset
export function clearLocalStorage() {
	if (browser) {
		localStorage.removeItem('valueScores');
		localStorage.removeItem('currentQuestionIndex');
	}
}
